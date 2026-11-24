import { type FormEvent, useEffect, useMemo, useState } from 'react'
import AuthGate from './AuthGate'
import BookSearch from './BookSearch'
import type { BookMatch } from './openLibrary'
import { supabase } from './supabase'

type Status = 'Unread' | 'Reading' | 'To Read' | 'Read'

type Book = {
  id: string
  title: string
  author: string
  status: Status
  progress: number
  palette: string
  mark: string
  category: string
  cover_photo: string | null
  description: string | null
  cover_url: string | null
  source_url: string | null
}

const statusOrder = ['Reading', 'To Read', 'Read'] as const
const statusPriority: Record<Status, number> = { Read: 0, Reading: 1, Unread: 2, 'To Read': 3 }
const statusLabels: Record<Status, string> = { Unread: 'Unread', Reading: 'Reading', 'To Read': 'Wishlist', Read: 'Read' }
const bookFields = 'id, title, author, status, progress, palette, mark, category, cover_photo, description, cover_url, source_url'
const coverTypes = ['image/jpeg', 'image/png', 'image/webp']
const maxCoverLength = 262144

function validCover(file: File) {
  return coverTypes.includes(file.type) && file.size <= 10 * 1024 * 1024
}

async function encodeCover(file: File) {
  const image = await createImageBitmap(file)
  try {
    const scale = Math.min(1, 480 / image.width, 720 / image.height)
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.width * scale))
    canvas.height = Math.max(1, Math.round(image.height * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Could not prepare the photo.')
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    const photo = canvas.toDataURL('image/webp', 0.8)
    if (!photo.startsWith('data:image/webp;base64,') || photo.length > maxCoverLength) {
      throw new Error('Could not encode the photo.')
    }
    return photo
  } finally {
    image.close()
  }
}

function Icon({
  name,
  size = 20,
}: {
  name: 'search' | 'plus' | 'book' | 'grid' | 'bookmark' | 'check' | 'clock' | 'more' | 'close' | 'arrow' | 'chevron-left'
  size?: number
}) {
  const paths = {
    search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>,
    plus: <><path d="M12 5v14M5 12h14" /></>,
    book: <><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" /></>,
    grid: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
    bookmark: <path d="M6 3h12v18l-6-4-6 4V3Z" />,
    check: <path d="m5 12 4 4L19 6" />,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    more: <><circle cx="5" cy="12" r="1" fill="currentColor" /><circle cx="12" cy="12" r="1" fill="currentColor" /><circle cx="19" cy="12" r="1" fill="currentColor" /></>,
    close: <><path d="m6 6 12 12M18 6 6 18" /></>,
    'chevron-left': <path d="m15 18-6-6 6-6" />,
    arrow: <><path d="M5 12h14M13 6l6 6-6 6" /></>,
  }
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}

function Cover({ book, large = false }: { book: Book; large?: boolean }) {
  const cover = book.cover_photo ?? book.cover_url
  return (
    <div className={`book-cover relative shrink-0 overflow-hidden rounded-[3px] bg-gradient-to-br ${book.palette} ${large ? 'w-full aspect-[2/3]' : 'w-12 h-[72px]'}`}>
      <div className="absolute inset-0 opacity-20 cover-noise" />
      <div className="absolute -right-7 top-[18%] h-24 w-24 rounded-full border border-white/30" />
      <div className="absolute -right-3 top-[30%] h-14 w-14 rounded-full border border-white/20" />
      <span className={`${large ? 'left-4 right-3 top-5 text-[clamp(11px,1.1vw,16px)]' : 'left-2 right-1 top-2 text-[6px]'} absolute whitespace-pre-line font-semibold leading-[1.05] tracking-[0.08em] text-white`}>
        {book.mark}
      </span>
      {large && <span className="absolute bottom-4 left-4 right-3 text-[9px] uppercase tracking-[0.16em] text-white/75">{book.author}</span>}
      {cover && <img src={cover} alt="" loading="lazy" referrerPolicy="no-referrer" className="absolute inset-0 size-full object-cover" onError={(event) => { event.currentTarget.hidden = true }} />}
    </div>
  )
}

function BookCard({ book, onUpdate }: {
  book: Book
  onUpdate: (id: string, changes: Partial<Pick<Book, 'status' | 'progress' | 'cover_photo'>>) => Promise<void>
}) {
  const [flipped, setFlipped] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function update(action: () => Promise<void>, message: string) {
    setBusy(true)
    setError('')
    try {
      await action()
    } catch {
      setError(message)
    } finally {
      setBusy(false)
    }
  }

  function changeCover(file: File) {
    setMenuOpen(false)
    if (!validCover(file)) {
      setError('Choose a JPEG, PNG, or WebP cover up to 10 MB.')
      return
    }
    void update(async () => {
      const cover = await encodeCover(file)
      await onUpdate(book.id, { cover_photo: cover })
    }, 'Could not save the cover. Try again.')
  }

  function changeStatus(status: Status) {
    const progress = status === 'Read' ? 100 : status === 'Reading' && book.status === 'Reading' ? book.progress : 0
    void update(() => onUpdate(book.id, { status, progress }), 'Could not update the book. Try again.')
  }

  return (
    <article className="min-w-0">
      <div className="relative mb-4 [perspective:1000px]">
        <div className="relative aspect-[2/3] w-full transition-transform duration-500 motion-reduce:transition-none"
          style={{ transformStyle: 'preserve-3d', transform: `rotateY(${flipped ? 180 : 0}deg)` }}>
          <div inert={flipped} className="absolute inset-0" style={{ backfaceVisibility: 'hidden', transform: 'rotateY(0deg)' }}>
            <button type="button" aria-label={`Show actions for ${book.title}`} onClick={() => { setMenuOpen(false); setFlipped(true) }} className="block w-full rounded-[3px] focus-visible:outline-[#c7ff36]">
              <Cover book={book} large />
            </button>
            <button type="button" aria-label={`Cover options for ${book.title}`} aria-expanded={menuOpen} disabled={busy} onClick={() => setMenuOpen(!menuOpen)} className="absolute right-2 top-2 grid size-8 place-items-center rounded-full bg-black/75 text-white hover:bg-[#c7ff36] hover:text-black">
              <Icon name="more" size={16} />
            </button>
            {menuOpen && (
              <label className="absolute right-2 top-12 z-10 cursor-pointer rounded-lg border border-white/15 bg-[#171219] px-3 py-2 text-xs font-semibold shadow-lg focus-within:outline focus-within:outline-[#c7ff36]">
                Change cover
                <input type="file" accept={coverTypes.join(',')} className="sr-only" onChange={(event) => {
                  const file = event.currentTarget.files?.[0]
                  if (file) changeCover(file)
                }} />
              </label>
            )}
          </div>
          <div inert={!flipped} className="absolute inset-0 rounded-[3px] border border-white/10 bg-black"
            style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}>
            <button type="button" aria-label={`Back to cover for ${book.title}`} onClick={() => setFlipped(false)} className="absolute left-1.5 top-1.5 z-10 grid size-7 place-items-center rounded-full text-white/75 hover:bg-white/10 hover:text-white"><Icon name="chevron-left" size={15} /></button>
            <div className="absolute inset-x-0 bottom-0 top-9 flex flex-col overflow-y-auto px-2.5 pb-2.5 sm:px-4 sm:pb-4">
              <div className="my-auto space-y-2 py-2">
              {book.status === 'To Read' ? (
                <button type="button" disabled={busy} onClick={() => changeStatus('Unread')} className="w-full rounded-lg bg-[#c7ff36] px-2 py-2 text-xs font-semibold text-black disabled:opacity-50">Add to collection</button>
              ) : (
                <>
                  <button type="button" disabled={busy || book.status === 'Read'} onClick={() => changeStatus('Read')} className="w-full rounded-lg bg-[#c7ff36] px-2 py-2 text-xs font-semibold text-black disabled:opacity-50">Mark as read</button>
                  <button type="button" disabled={busy || book.status === 'Reading'} onClick={() => changeStatus('Reading')} className="w-full rounded-lg bg-white/10 px-2 py-2 text-xs font-semibold disabled:opacity-50">Mark as reading now</button>
                </>
              )}
              </div>
            </div>
          </div>
        </div>
      </div>
      <h2 className="truncate font-display text-[16px] font-semibold tracking-[-0.015em]">{book.title}</h2>
      <p className="mt-1 truncate text-xs text-white/42">{book.author}</p>
      {(book.description || book.source_url) && (
        <details className="mt-2 text-xs text-white/60">
          <summary className="cursor-pointer">Book details</summary>
          {book.description && <p className="mt-2 whitespace-pre-wrap break-words leading-5">{book.description}</p>}
          {book.source_url && <a href={book.source_url} target="_blank" rel="noreferrer" className="mt-2 inline-block underline">Book source</a>}
        </details>
      )}
      <div className="mt-3">
        {book.status === 'Reading' ? (
          <>
            <div className="mb-1.5 flex justify-between text-[10px] font-medium uppercase tracking-[0.1em] text-white/35"><span>Reading</span><span>{book.progress}%</span></div>
            <div className="h-1 overflow-hidden rounded-full bg-white/[0.08]"><div style={{ width: `${book.progress}%` }} className="h-full rounded-full bg-[#c7ff36]" /></div>
          </>
        ) : <span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] ${book.status === 'Read' ? 'bg-[#c7ff36]/10 text-[#c7ff36]' : 'bg-[#3a2546] text-[#c4a4d1]'}`}>{statusLabels[book.status]}</span>}
      </div>
      {busy && <p role="status" className="mt-2 text-xs text-white/60">Saving…</p>}
      {error && <p role="alert" className="mt-2 text-xs text-red-300">{error}</p>}
    </article>
  )
}

export default function App() {
  return <AuthGate>{(session) => <Library key={session.user.id} />}</AuthGate>
}

function Library() {
  const [books, setBooks] = useState<Book[]>([])
  const [filter, setFilter] = useState<'All' | Status>('All')
  const [query, setQuery] = useState('')
  const [sortByStatus, setSortByStatus] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [draft, setDraft] = useState<Omit<BookMatch, 'id' | 'sourceUrl'> & { sourceUrl: string | null } | null>(null)
  const [keepCover, setKeepCover] = useState(true)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [saveError, setSaveError] = useState('')
  const [saving, setSaving] = useState(false)
  const [signOutError, setSignOutError] = useState('')

  useEffect(() => {
    if (!supabase) return
    const client = supabase
    let active = true

    async function loadBooks() {
      try {
        const { data, error } = await client.from('books')
          .select(bookFields)
          .order('created_at', { ascending: false })
          .returns<Book[]>()
        if (!active) return
        if (error) throw error
        setBooks(data)
      } catch {
        if (active) setLoadError('Could not load your books.')
      } finally {
        if (active) setLoading(false)
      }
    }

    void loadBooks()
    return () => { active = false }
  }, [loadAttempt])

  async function signOut() {
    if (!supabase) return
    setSignOutError('')
    try {
      const { error } = await supabase.auth.signOut({ scope: 'local' })
      if (error) throw error
    } catch {
      setSignOutError('Could not sign out. Try again.')
    }
  }

  const counts = useMemo(() => ({
    All: books.filter((book) => book.status !== 'To Read').length,
    Reading: books.filter((book) => book.status === 'Reading').length,
    'To Read': books.filter((book) => book.status === 'To Read').length,
    Read: books.filter((book) => book.status === 'Read').length,
  }), [books])

  const visibleBooks = books.filter((book) => {
    const matchesFilter = filter === 'All' ? book.status !== 'To Read' : book.status === filter
    const value = `${book.title} ${book.author}`.toLowerCase()
    return matchesFilter && value.includes(query.toLowerCase())
  })
  if (filter === 'All' && sortByStatus) {
    visibleBooks.sort((first, second) => statusPriority[first.status] - statusPriority[second.status])
  }

  async function updateBook(id: string, changes: Partial<Pick<Book, 'status' | 'progress' | 'cover_photo'>>) {
    if (!supabase) throw new Error('Supabase is unavailable.')
    const { data, error } = await supabase.from('books').update(changes).eq('id', id).select('id').single()
    if (error || !data) throw error ?? new Error('Book not found.')
    setBooks((current) => current.map((book) => book.id === id ? { ...book, ...changes } : book))
  }

  async function addBook(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || loading || loadError || saving) return
    const data = new FormData(event.currentTarget, (event.nativeEvent as SubmitEvent).submitter)
    const title = String(data.get('title') || '').trim()
    const author = String(data.get('author') || '').trim()
    const status: Status = data.get('destination') === 'wishlist' ? 'To Read' : 'Unread'
    const description = String(data.get('description') || '').trim()
    if (!title || !author) return
    const selectedCover = data.get('cover')
    const cover = selectedCover instanceof File && selectedCover.name ? selectedCover : null
    if (cover && !validCover(cover)) {
      setSaveError('Choose a JPEG, PNG, or WebP cover photo up to 10 MB.')
      return
    }
    const palettes = [
      'from-[#1c1521] via-[#5c3471] to-[#c066db]',
      'from-[#171d28] via-[#344f69] to-[#85a7a4]',
      'from-[#2a1619] via-[#803a45] to-[#d28e7a]',
    ]
    setSaving(true)
    setSaveError('')
    try {
      let coverPhoto = null
      if (cover) {
        try {
          coverPhoto = await encodeCover(cover)
        } catch {
          setSaveError('Could not prepare that cover photo. Try a different image.')
          return
        }
      }
      const { data: book, error } = await supabase.from('books').insert({
        title,
        author,
        status,
        progress: 0,
        palette: palettes[books.length % palettes.length],
        mark: title.toUpperCase(),
        category: 'My collection',
        cover_photo: coverPhoto,
        cover_url: coverPhoto || !keepCover ? null : draft?.coverUrl ?? null,
        description: description || null,
        source_url: draft?.sourceUrl ?? null,
      }).select(bookFields).single<Book>()
      if (error) throw error
      setBooks((current) => [book, ...current])
      setFilter(status === 'To Read' ? 'To Read' : 'All')
      setQuery('')
      setShowAdd(false)
    } catch {
      setSaveError('Could not save the book. Refresh your library before retrying if the connection dropped.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#0b0b0d] text-[#f4f2f5] selection:bg-[#c7ff36] selection:text-black">
      <header className="fixed inset-x-0 top-0 z-30 border-b border-white/[0.08] bg-[#0b0b0d]/90 backdrop-blur-xl">
        <div className="mx-auto flex h-[72px] max-w-[1500px] items-center gap-6 px-5 md:px-8">
          <div className="flex min-w-fit items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-full bg-[#c7ff36] text-black"><Icon name="book" size={18} /></div>
            <span className="font-display text-[21px] font-semibold tracking-[-0.03em]">folio.</span>
          </div>
          <div className="relative mx-auto hidden w-full max-w-md md:block">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-white/35"><Icon name="search" size={18} /></span>
            <input value={query} onChange={(e) => setQuery(e.target.value)} className="h-10 w-full rounded-full border border-white/[0.08] bg-white/[0.045] pl-11 pr-4 text-sm outline-none transition focus:border-[#c7ff36]/60 focus:bg-white/[0.07]" placeholder="Search your library" />
          </div>
          <button aria-label="Add Book" disabled={loading || Boolean(loadError)} onClick={() => { setSaveError(''); setDraft(null); setShowAdd(true) }} className="ml-auto flex h-10 items-center gap-2 rounded-full bg-[#c7ff36] px-4 text-sm font-semibold text-[#111] transition hover:bg-[#dbff79] active:scale-[.98]">
            <Icon name="plus" size={17} /><span className="hidden sm:inline">Add Book</span>
          </button>
          <button onClick={signOut} className="shrink-0 text-xs text-white/60 hover:text-white">Sign out</button>
        </div>
      </header>

      <main className="mx-auto flex min-h-screen max-w-[1500px] pt-[72px]">
        <aside className="hidden w-[242px] shrink-0 border-r border-white/[0.07] px-5 py-8 lg:block">
          <p className="mb-3 px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/30">Library</p>
          {[
            { label: 'All books', value: 'All', icon: 'grid' },
            { label: 'Reading now', value: 'Reading', icon: 'clock' },
            { label: statusLabels['To Read'], value: 'To Read', icon: 'bookmark' },
            { label: 'Finished', value: 'Read', icon: 'check' },
          ].map((item) => (
            <button key={item.value} onClick={() => setFilter(item.value as 'All' | Status)} className={`mb-1 flex h-11 w-full items-center gap-3 rounded-lg px-3 text-sm transition ${filter === item.value ? 'bg-[#372443] text-white' : 'text-white/50 hover:bg-white/[0.04] hover:text-white'}`}>
              <span className={filter === item.value ? 'text-[#c7ff36]' : ''}><Icon name={item.icon as 'grid'} size={17} /></span>
              <span>{item.label}</span><span className="ml-auto text-xs text-white/25">{counts[item.value as keyof typeof counts]}</span>
            </button>
          ))}
        </aside>

        <section className="min-w-0 flex-1 px-5 pb-14 pt-8 md:px-9 md:pt-11 xl:px-12">
          <div className="mb-8 flex flex-col justify-between gap-6 md:flex-row md:items-end">
            <div>
              <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-[#c7ff36]">Personal library</p>
              <h1 className="font-display text-4xl font-medium tracking-[-0.045em] md:text-5xl">{filter === 'To Read' ? 'Wishlist' : 'Your collection'}</h1>
              <p className="mt-3 max-w-lg text-sm leading-6 text-white/40">A quiet place for every story you’re reading, loved, or still waiting to discover.</p>
            </div>
            <div className="flex items-center gap-2 overflow-x-auto pb-1 lg:hidden">
              {(['All', ...statusOrder] as const).map((item) => (
                <button key={item} onClick={() => setFilter(item)} className={`whitespace-nowrap rounded-full px-4 py-2 text-xs font-medium ${filter === item ? 'bg-[#c7ff36] text-black' : 'bg-white/[0.06] text-white/50'}`}>{item === 'All' ? item : statusLabels[item]}</button>
              ))}
            </div>
            <div className="relative md:hidden">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-white/35"><Icon name="search" size={18} /></span>
              <input value={query} onChange={(e) => setQuery(e.target.value)} className="h-11 w-full rounded-full border border-white/[0.08] bg-white/[0.045] pl-11 pr-4 text-sm outline-none focus:border-[#c7ff36]/60" placeholder="Search your library" />
            </div>
          </div>

          <div className="mb-6 flex items-center justify-between border-b border-white/[0.07] pb-4">
            <p className="text-sm text-white/45"><span className="font-medium text-white">{visibleBooks.length}</span> {visibleBooks.length === 1 ? 'book' : 'books'}</p>
            {filter === 'All' && (
              <label className="flex items-center gap-2 text-xs text-white/60">
                Sort by
                <select value={sortByStatus ? 'status' : 'recent'} onChange={(event) => setSortByStatus(event.target.value === 'status')} className="rounded-lg border border-white/10 bg-[#171219] px-2 py-1.5 text-white">
                  <option value="status">Status</option>
                  <option value="recent">Recently added</option>
                </select>
              </label>
            )}
          </div>

          {signOutError && <p role="alert" className="mb-4 text-sm text-red-300">{signOutError}</p>}
          {loading ? <p role="status">Loading your books...</p> : loadError ? (
            <div role="alert" className="flex items-center gap-4 text-sm">
              <p>{loadError}</p>
              <button className="text-[#c7ff36]" onClick={() => {
                setLoading(true)
                setLoadError('')
                setLoadAttempt((attempt) => attempt + 1)
              }}>Try again</button>
            </div>
          ) : visibleBooks.length > 0 ? (
            <div className="grid grid-cols-2 gap-x-4 gap-y-9 sm:grid-cols-3 md:gap-x-6 xl:grid-cols-4 2xl:grid-cols-5">
              {visibleBooks.map((book) => (
                <BookCard key={book.id} book={book} onUpdate={updateBook} />
              ))}
            </div>
          ) : (
            <div className="flex min-h-[360px] flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-white/[0.02] text-center">
              <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-[#32203d] text-[#c7ff36]"><Icon name="book" /></div>
              <h2 className="font-display text-xl font-semibold">{query.trim() ? 'No books found' : filter === 'To Read' ? 'Your wishlist is empty' : 'No books here yet'}</h2>
              <p className="mt-2 text-sm text-white/35">{query.trim() ? 'Try another search.' : 'Use Add Book to add a title.'}</p>
            </div>
          )}
        </section>
      </main>

      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 p-0 backdrop-blur-sm sm:items-center sm:p-5" onMouseDown={() => { if (!saving) setShowAdd(false) }}>
          <div role="dialog" aria-modal="true" aria-labelledby="add-book-heading" className="max-h-[100dvh] w-full max-w-lg overflow-y-auto rounded-t-[24px] border border-white/10 bg-[#171219] p-6 shadow-2xl sm:rounded-[24px] sm:p-8" onMouseDown={(e) => e.stopPropagation()}>
            <div className="mb-7 flex items-start justify-between">
              <h2 id="add-book-heading" className="font-display text-3xl font-semibold tracking-[-0.035em]">Add Book</h2>
              <button aria-label="Close" disabled={saving} onClick={() => setShowAdd(false)} className="flex size-9 items-center justify-center rounded-full bg-white/[0.06] text-white/50 hover:text-white"><Icon name="close" size={18} /></button>
            </div>
            {!draft ? (
              <BookSearch onChoose={(book) => { setKeepCover(true); setDraft(book) }}
                onCustom={(title) => setDraft({ title, author: '', description: '', coverUrl: null, sourceUrl: null })} />
            ) : <form onSubmit={addBook}>
              <button type="button" disabled={saving} onClick={() => { setSaveError(''); setDraft(null) }} className="mb-4 text-sm text-[#c7ff36]">Back to search</button>
              <label className="mb-5 block"><span className="mb-2 block text-xs font-medium text-white/45">Book title</span><input required autoFocus name="title" defaultValue={draft.title} placeholder="e.g. The Dispossessed" className="h-12 w-full rounded-xl border border-white/10 bg-black/25 px-4 text-sm outline-none transition placeholder:text-white/20 focus:border-[#c7ff36]/60" /></label>
              <label className="mb-5 block"><span className="mb-2 block text-xs font-medium text-white/45">Author</span><input required name="author" defaultValue={draft.author} placeholder="Author’s name" className="h-12 w-full rounded-xl border border-white/10 bg-black/25 px-4 text-sm outline-none transition placeholder:text-white/20 focus:border-[#c7ff36]/60" /></label>
              <label className="mb-5 block"><span className="mb-2 block text-xs font-medium text-white/45">Description (optional)</span><textarea name="description" defaultValue={draft.description} maxLength={4000} rows={3} className="w-full rounded-xl border border-white/10 bg-black/25 px-4 py-3 text-sm outline-none focus:border-[#c7ff36]/60" /></label>
              {draft.coverUrl && (
                <label className="mb-4 flex items-center gap-3 text-sm text-white/70">
                  <img src={draft.coverUrl} alt="" referrerPolicy="no-referrer" className="h-20 w-14 rounded object-cover" />
                  <input type="checkbox" checked={keepCover} disabled={saving} onChange={(event) => setKeepCover(event.target.checked)} />
                  Keep this cover
                </label>
              )}
              <label className="mb-6 block">
                <span className="mb-2 block text-xs font-medium text-white/45">Cover photo (optional)</span>
                <input type="file" name="cover" accept={coverTypes.join(',')} disabled={saving} aria-describedby="cover-help" className="w-full rounded-xl border border-white/10 bg-black/25 p-2 text-sm text-white/70 file:mr-3 file:rounded-lg file:bg-white/10 file:px-3 file:py-2 file:text-white focus-visible:outline-[#c7ff36]/60" />
                <span id="cover-help" className="mt-2 block text-xs text-white/45">JPEG, PNG, or WebP, up to 10 MB.</span>
              </label>
              {saveError && <p role="alert" className="mb-4 text-sm text-red-300">{saveError}</p>}
              <div className="grid gap-3 sm:grid-cols-2">
                <button type="submit" name="destination" value="collection" disabled={saving} className="min-h-12 rounded-xl bg-[#c7ff36] px-3 text-sm font-semibold text-black hover:bg-[#dbff79] disabled:opacity-50">Add to collection</button>
                <button type="submit" name="destination" value="wishlist" disabled={saving} className="min-h-12 rounded-xl border border-white/15 px-3 text-sm font-semibold hover:bg-white/10 disabled:opacity-50">Add to wishlist</button>
              </div>
              {saving && <p role="status" className="mt-3 text-sm text-white/60">Saving...</p>}
            </form>}
          </div>
        </div>
      )}
    </div>
  )
}
