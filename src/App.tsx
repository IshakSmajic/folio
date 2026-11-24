import { type FormEvent, useEffect, useMemo, useState } from 'react'
import AuthGate from './AuthGate'
import { supabase } from './supabase'

type Status = 'Reading' | 'To Read' | 'Read'

type Book = {
  id: string
  title: string
  author: string
  status: Status
  progress: number
  palette: string
  mark: string
  category: string
}

const statusOrder: Status[] = ['Reading', 'To Read', 'Read']

function Icon({
  name,
  size = 20,
}: {
  name: 'search' | 'plus' | 'book' | 'grid' | 'bookmark' | 'check' | 'clock' | 'more' | 'close' | 'arrow'
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
    arrow: <><path d="M5 12h14M13 6l6 6-6 6" /></>,
  }
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}

function Cover({ book, large = false }: { book: Book; large?: boolean }) {
  return (
    <div className={`book-cover relative shrink-0 overflow-hidden rounded-[3px] bg-gradient-to-br ${book.palette} ${large ? 'w-full aspect-[2/3]' : 'w-12 h-[72px]'}`}>
      <div className="absolute inset-0 opacity-20 cover-noise" />
      <div className="absolute -right-7 top-[18%] h-24 w-24 rounded-full border border-white/30" />
      <div className="absolute -right-3 top-[30%] h-14 w-14 rounded-full border border-white/20" />
      <span className={`${large ? 'left-4 right-3 top-5 text-[clamp(11px,1.1vw,16px)]' : 'left-2 right-1 top-2 text-[6px]'} absolute whitespace-pre-line font-semibold leading-[1.05] tracking-[0.08em] text-white`}>
        {book.mark}
      </span>
      {large && <span className="absolute bottom-4 left-4 right-3 text-[9px] uppercase tracking-[0.16em] text-white/75">{book.author}</span>}
    </div>
  )
}

export default function App() {
  return <AuthGate>{(session) => <Library key={session.user.id} />}</AuthGate>
}

function Library() {
  const [books, setBooks] = useState<Book[]>([])
  const [filter, setFilter] = useState<'All' | Status>('All')
  const [query, setQuery] = useState('')
  const [showAdd, setShowAdd] = useState(false)
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
          .select('id, title, author, status, progress, palette, mark, category')
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
    All: books.length,
    Reading: books.filter((book) => book.status === 'Reading').length,
    'To Read': books.filter((book) => book.status === 'To Read').length,
    Read: books.filter((book) => book.status === 'Read').length,
  }), [books])

  const visibleBooks = books.filter((book) => {
    const matchesFilter = filter === 'All' || book.status === filter
    const value = `${book.title} ${book.author}`.toLowerCase()
    return matchesFilter && value.includes(query.toLowerCase())
  })

  async function addBook(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || loading || loadError || saving) return
    const data = new FormData(event.currentTarget)
    const title = String(data.get('title') || '').trim()
    const author = String(data.get('author') || '').trim()
    const status = String(data.get('status')) as Status
    if (!title || !author) return
    const palettes = [
      'from-[#1c1521] via-[#5c3471] to-[#c066db]',
      'from-[#171d28] via-[#344f69] to-[#85a7a4]',
      'from-[#2a1619] via-[#803a45] to-[#d28e7a]',
    ]
    setSaving(true)
    setSaveError('')
    try {
      const { data: book, error } = await supabase.from('books').insert({
        title,
        author,
        status,
        progress: status === 'Read' ? 100 : status === 'Reading' ? 12 : 0,
        palette: palettes[books.length % palettes.length],
        mark: title.toUpperCase(),
        category: 'My collection',
      }).select('id, title, author, status, progress, palette, mark, category').single<Book>()
      if (error) throw error
      setBooks((current) => [book, ...current])
      setFilter('All')
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
          <button disabled={loading || Boolean(loadError)} onClick={() => { setSaveError(''); setShowAdd(true) }} className="ml-auto flex h-10 items-center gap-2 rounded-full bg-[#c7ff36] px-4 text-sm font-semibold text-[#111] transition hover:bg-[#dbff79] active:scale-[.98]">
            <Icon name="plus" size={17} /><span className="hidden sm:inline">Add book</span>
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
            { label: 'Want to read', value: 'To Read', icon: 'bookmark' },
            { label: 'Finished', value: 'Read', icon: 'check' },
          ].map((item) => (
            <button key={item.value} onClick={() => setFilter(item.value as 'All' | Status)} className={`mb-1 flex h-11 w-full items-center gap-3 rounded-lg px-3 text-sm transition ${filter === item.value ? 'bg-[#372443] text-white' : 'text-white/50 hover:bg-white/[0.04] hover:text-white'}`}>
              <span className={filter === item.value ? 'text-[#c7ff36]' : ''}><Icon name={item.icon as 'grid'} size={17} /></span>
              <span>{item.label}</span><span className="ml-auto text-xs text-white/25">{counts[item.value as keyof typeof counts]}</span>
            </button>
          ))}
          <div className="my-7 h-px bg-white/[0.07]" />
          <p className="mb-3 px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/30">Collections</p>
          {['Modern classics', 'Nightstand', 'Sci-fi & strange'].map((collection, index) => (
            <button key={collection} className="flex h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-sm text-white/50 transition hover:bg-white/[0.04] hover:text-white">
              <span className={`size-2 rounded-full ${['bg-[#9d68bb]', 'bg-[#c7ff36]', 'bg-[#6e457f]'][index]}`} />{collection}
            </button>
          ))}
          <button className="mt-2 flex h-10 items-center gap-2 px-3 text-xs font-medium text-white/30 hover:text-[#c7ff36]"><Icon name="plus" size={15} /> New collection</button>
        </aside>

        <section className="min-w-0 flex-1 px-5 pb-14 pt-8 md:px-9 md:pt-11 xl:px-12">
          <div className="mb-8 flex flex-col justify-between gap-6 md:flex-row md:items-end">
            <div>
              <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-[#c7ff36]">Personal library</p>
              <h1 className="font-display text-4xl font-medium tracking-[-0.045em] md:text-5xl">Your collection</h1>
              <p className="mt-3 max-w-lg text-sm leading-6 text-white/40">A quiet place for every story you’re reading, loved, or still waiting to discover.</p>
            </div>
            <div className="flex items-center gap-2 overflow-x-auto pb-1 lg:hidden">
              {(['All', ...statusOrder] as const).map((item) => (
                <button key={item} onClick={() => setFilter(item)} className={`whitespace-nowrap rounded-full px-4 py-2 text-xs font-medium ${filter === item ? 'bg-[#c7ff36] text-black' : 'bg-white/[0.06] text-white/50'}`}>{item}</button>
              ))}
            </div>
            <div className="relative md:hidden">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-white/35"><Icon name="search" size={18} /></span>
              <input value={query} onChange={(e) => setQuery(e.target.value)} className="h-11 w-full rounded-full border border-white/[0.08] bg-white/[0.045] pl-11 pr-4 text-sm outline-none focus:border-[#c7ff36]/60" placeholder="Search your library" />
            </div>
          </div>

          <div className="mb-6 flex items-center justify-between border-b border-white/[0.07] pb-4">
            <p className="text-sm text-white/45"><span className="font-medium text-white">{visibleBooks.length}</span> {visibleBooks.length === 1 ? 'book' : 'books'}</p>
            <button className="flex items-center gap-2 text-xs text-white/40 hover:text-white">Recently added <span className="text-[10px]">↓</span></button>
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
                <article key={book.id} className="group min-w-0">
                  <div className="relative mb-4">
                    <Cover book={book} large />
                    <button aria-label={`More options for ${book.title}`} className="absolute right-2.5 top-2.5 flex size-8 items-center justify-center rounded-full bg-black/55 text-white/75 opacity-0 backdrop-blur transition hover:bg-[#c7ff36] hover:text-black group-hover:opacity-100"><Icon name="more" size={16} /></button>
                    {book.status === 'Read' && <div className="absolute bottom-3 right-3 flex size-8 items-center justify-center rounded-full bg-[#c7ff36] text-black shadow-lg"><Icon name="check" size={16} /></div>}
                  </div>
                  <div className="flex gap-2">
                    <div className="min-w-0 flex-1">
                      <h2 className="truncate font-display text-[16px] font-semibold tracking-[-0.015em]">{book.title}</h2>
                      <p className="mt-1 truncate text-xs text-white/42">{book.author}</p>
                    </div>
                    <button className="mt-0.5 text-white/20 transition hover:text-[#c7ff36]"><Icon name="bookmark" size={17} /></button>
                  </div>
                  <div className="mt-3">
                    {book.status === 'Reading' ? (
                      <>
                        <div className="mb-1.5 flex justify-between text-[10px] font-medium uppercase tracking-[0.1em] text-white/35"><span>Reading</span><span>{book.progress}%</span></div>
                        <div className="h-1 overflow-hidden rounded-full bg-white/[0.08]"><div style={{ width: `${book.progress}%` }} className="h-full rounded-full bg-[#c7ff36]" /></div>
                      </>
                    ) : <span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] ${book.status === 'Read' ? 'bg-[#c7ff36]/10 text-[#c7ff36]' : 'bg-[#3a2546] text-[#c4a4d1]'}`}>{book.status}</span>}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="flex min-h-[360px] flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-white/[0.02] text-center">
              <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-[#32203d] text-[#c7ff36]"><Icon name="book" /></div>
              <h2 className="font-display text-xl font-semibold">{books.length === 0 ? 'Your collection is empty' : 'No books found'}</h2>
              <p className="mt-2 text-sm text-white/35">{books.length === 0 ? 'Use Add book to start your collection.' : 'Try another search or add a new book.'}</p>
            </div>
          )}
        </section>
      </main>

      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 p-0 backdrop-blur-sm sm:items-center sm:p-5" onMouseDown={() => { if (!saving) setShowAdd(false) }}>
          <div className="w-full max-w-lg rounded-t-[24px] border border-white/10 bg-[#171219] p-6 shadow-2xl sm:rounded-[24px] sm:p-8" onMouseDown={(e) => e.stopPropagation()}>
            <div className="mb-7 flex items-start justify-between">
              <div><p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-[#c7ff36]">Grow your library</p><h2 className="font-display text-3xl font-semibold tracking-[-0.035em]">Add a new book</h2></div>
              <button disabled={saving} onClick={() => setShowAdd(false)} className="flex size-9 items-center justify-center rounded-full bg-white/[0.06] text-white/50 hover:text-white"><Icon name="close" size={18} /></button>
            </div>
            <form onSubmit={addBook}>
              <label className="mb-5 block"><span className="mb-2 block text-xs font-medium text-white/45">Book title</span><input required autoFocus name="title" placeholder="e.g. The Dispossessed" className="h-12 w-full rounded-xl border border-white/10 bg-black/25 px-4 text-sm outline-none transition placeholder:text-white/20 focus:border-[#c7ff36]/60" /></label>
              <label className="mb-5 block"><span className="mb-2 block text-xs font-medium text-white/45">Author</span><input required name="author" placeholder="Author’s name" className="h-12 w-full rounded-xl border border-white/10 bg-black/25 px-4 text-sm outline-none transition placeholder:text-white/20 focus:border-[#c7ff36]/60" /></label>
              <label className="mb-8 block"><span className="mb-2 block text-xs font-medium text-white/45">Reading status</span><select name="status" className="h-12 w-full appearance-none rounded-xl border border-white/10 bg-[#100d12] px-4 text-sm outline-none focus:border-[#c7ff36]/60"><option>To Read</option><option>Reading</option><option>Read</option></select></label>
              {saveError && <p role="alert" className="mb-4 text-sm text-red-300">{saveError}</p>}
              <button disabled={saving} className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#c7ff36] text-sm font-semibold text-black transition hover:bg-[#dbff79] active:scale-[.99]">{saving ? 'Saving...' : 'Add to collection'} <Icon name="arrow" size={17} /></button>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
