import { type FormEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import AuthGate from './AuthGate'
import BookSearch from './BookSearch'
import Friends from './Friends'
import { type BookMatch, catalogIdentity, discoverBooks, loadBookMetadata } from './openLibrary'
import { cleanTags, latestRatedBook, normalizeTag, recommendBooks } from './recommendations'
import { supabase } from './supabase'

type Status = 'Unread' | 'Reading' | 'To Read' | 'Read'

type Book = {
  id: string
  title: string
  author: string
  status: Status
  progress: number
  current_page: number | null
  total_pages: number | null
  palette: string
  mark: string
  category: string
  cover_photo: string | null
  description: string | null
  cover_url: string | null
  source_url: string | null
  rating: number | null
  rated_at: string | null
  tags: string[]
  series: string | null
}

type BookChanges = Partial<Pick<Book, 'title' | 'author' | 'description' | 'mark' | 'status' | 'progress' | 'cover_photo' | 'current_page' | 'total_pages' | 'rating' | 'tags' | 'series'>>
type BookView = 'details' | 'edit' | 'progress' | 'wishlist' | 'remove' | 'rating'

const statusOrder = ['Reading', 'To Read', 'Read'] as const
const statusPriority: Record<Status, number> = { Read: 0, Reading: 1, Unread: 2, 'To Read': 3 }
const statusLabels: Record<Status, string> = { Unread: 'Unread', Reading: 'Reading', 'To Read': 'Wishlist', Read: 'Read' }
const bookFields = 'id, title, author, status, progress, current_page, total_pages, palette, mark, category, cover_photo, description, cover_url, source_url, rating, rated_at, tags, series'
const coverTypes = ['image/jpeg', 'image/png', 'image/webp']
const maxCoverLength = 262144

function normalizedBookText(value: string) {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase()
}

function TagsField({ initialTags, suggestions }: { initialTags: string[]; suggestions: string[] }) {
  const [value, setValue] = useState(initialTags.join(', '))
  const tags = cleanTags(value.split(','))
  const selected = new Set(tags.map(normalizeTag))
  const available = suggestions.filter((tag) => !selected.has(normalizeTag(tag))).slice(0, 6)

  return (
    <div className="mb-5">
      <label className="block text-sm text-white/70">
        Tags (optional)
        <input name="tags" value={value} onChange={(event) => setValue(event.target.value)} maxLength={1240}
          placeholder="e.g. Black Templars, siege defense" className="mt-2 w-full rounded-xl border border-white/15 bg-black/25 px-3 py-2 text-white" />
      </label>
      <p className="mt-1 text-xs text-white/50">Separate tags with commas.</p>
      {tags.length < 20 && available.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2" aria-label="Tags from your library">
          {available.map((tag) => <button key={tag} type="button" onClick={() => setValue([...tags, tag].join(', '))}
            className="rounded-full bg-white/10 px-2.5 py-1 text-xs text-white/75 hover:bg-white/20">+ {tag}</button>)}
        </div>
      )}
    </div>
  )
}

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
  name: 'search' | 'plus' | 'book' | 'grid' | 'bookmark' | 'check' | 'clock' | 'more' | 'close' | 'arrow' | 'friends'
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
    friends: <><circle cx="9" cy="7" r="3" /><path d="M3 20v-2a6 6 0 0 1 12 0v2M16 4a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 5v2" /></>,
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
      {cover && <img key={cover} src={cover} alt="" loading="lazy" referrerPolicy="no-referrer" className="absolute inset-0 size-full object-cover" onError={(event) => { event.currentTarget.hidden = true }} />}
    </div>
  )
}

function BookCard({ book, onUpdate, onOpen }: {
  book: Book
  onUpdate: (id: string, changes: BookChanges) => Promise<void>
  onOpen: (view: BookView) => void
}) {
  const [flipped, setFlipped] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const flipArea = useRef<HTMLDivElement>(null)
  const coverButton = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!flipped) return

    function handleOutsidePointer(event: PointerEvent) {
      if (event.target instanceof Node && !flipArea.current?.contains(event.target)) setFlipped(false)
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.defaultPrevented || event.key !== 'Escape' || !flipArea.current?.contains(document.activeElement)) return
      setFlipped(false)
      requestAnimationFrame(() => coverButton.current?.focus())
    }

    document.addEventListener('pointerdown', handleOutsidePointer, true)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('pointerdown', handleOutsidePointer, true)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [flipped])

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
    const changes: BookChanges = { status }
    if (status === 'Read') {
      changes.progress = 100
      changes.current_page = book.total_pages
    } else if (status === 'Reading' && book.progress === 100) {
      changes.progress = 0
      changes.current_page = book.total_pages === null ? null : 0
    }
    void update(() => onUpdate(book.id, changes), 'Could not update the book. Try again.')
  }

  function open(view: BookView) {
    setMenuOpen(false)
    onOpen(view)
  }

  return (
    <article className="min-w-0">
      <div ref={flipArea} className="relative mb-4 [perspective:1000px]">
        <div className="relative aspect-[2/3] w-full transition-transform duration-500 motion-reduce:transition-none"
          style={{ transformStyle: 'preserve-3d', transform: `rotateY(${flipped ? 180 : 0}deg)` }}>
          <div inert={flipped} className="absolute inset-0" style={{ backfaceVisibility: 'hidden', transform: 'rotateY(0deg)' }}>
            <button ref={coverButton} type="button" aria-label={`Show actions for ${book.title}`} onClick={() => { setMenuOpen(false); setFlipped(true) }} className="block w-full rounded-[3px] focus-visible:outline-[#c7ff36]">
              <Cover book={book} large />
            </button>
            <button type="button" aria-label={`Book options for ${book.title}`} aria-expanded={menuOpen} disabled={busy} onClick={() => setMenuOpen(!menuOpen)} className="absolute right-2 top-2 grid size-8 place-items-center rounded-full bg-black/75 text-white hover:bg-[#c7ff36] hover:text-black">
              <Icon name="more" size={16} />
            </button>
            {menuOpen && (
              <div className="absolute inset-x-2 top-12 z-10 space-y-1 rounded-lg border border-white/15 bg-[#171219] p-1 text-xs font-semibold shadow-lg">
                <label className="block cursor-pointer rounded px-2 py-2 hover:bg-white/10 focus-within:outline focus-within:outline-[#c7ff36]">
                  Change cover
                  <input type="file" accept={coverTypes.join(',')} className="sr-only" onChange={(event) => {
                    const file = event.currentTarget.files?.[0]
                    if (file) changeCover(file)
                  }} />
                </label>
                <button type="button" onClick={() => open('edit')} className="block w-full rounded px-2 py-2 text-left hover:bg-white/10">Edit details</button>
                {book.status !== 'To Read' && <button type="button" onClick={() => open('wishlist')} className="block w-full rounded px-2 py-2 text-left hover:bg-white/10">Move to wishlist</button>}
                <button type="button" onClick={() => open('remove')} className="block w-full rounded px-2 py-2 text-left text-red-300 hover:bg-white/10">Remove book</button>
              </div>
            )}
          </div>
          <div inert={!flipped} className="absolute inset-0 rounded-[3px] border border-white/10 bg-black"
            style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}>
            <div className="absolute inset-0 flex flex-col overflow-y-auto p-2.5 sm:p-4">
              <div className="my-auto space-y-2 py-2">
              {book.status === 'To Read' ? (
                <button type="button" disabled={busy} onClick={() => changeStatus('Unread')} className="w-full rounded-lg bg-[#c7ff36] px-2 py-2 text-xs font-semibold text-black disabled:opacity-50">Add to collection</button>
              ) : (
                <>
                  {book.status === 'Read' && book.rating !== null ? (
                    <p className="text-center text-xs font-semibold text-[#c7ff36]">You rated this a {book.rating}/10</p>
                  ) : (
                    <button type="button" disabled={busy} onClick={() => book.rating === null ? open('rating') : changeStatus('Read')} className="w-full rounded-lg bg-[#c7ff36] px-2 py-2 text-xs font-semibold text-black disabled:opacity-50">{book.status === 'Read' ? 'Rate book' : 'Mark as read'}</button>
                  )}
                  <button type="button" disabled={busy || book.status === 'Reading'} onClick={() => changeStatus('Reading')} className="w-full rounded-lg bg-white/10 px-2 py-2 text-xs font-semibold disabled:opacity-50">Mark as reading now</button>
                  {book.status === 'Reading' && <button type="button" disabled={busy} onClick={() => open('progress')} className="w-full rounded-lg bg-white/10 px-2 py-2 text-xs font-semibold disabled:opacity-50">Update progress</button>}
                </>
              )}
              </div>
            </div>
          </div>
        </div>
      </div>
      <h2 className="font-display text-[16px] font-semibold tracking-[-0.015em]"><button type="button" onClick={() => open('details')} className="block w-full truncate text-left hover:text-[#c7ff36]">{book.title}</button></h2>
      <p className="mt-1 truncate text-xs text-white/42">{book.author}</p>
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

const bookViewTitles: Record<BookView, string> = {
  details: 'Book details',
  edit: 'Edit book',
  progress: 'Update progress',
  wishlist: 'Move to wishlist',
  remove: 'Remove book',
  rating: 'Rate book',
}

function BookDialog({ book, view, tagSuggestions, onClose, onOpen, onUpdate, onRemove }: {
  book: Book
  view: BookView
  tagSuggestions: string[]
  onClose: () => void
  onOpen: (view: BookView) => void
  onUpdate: (id: string, changes: BookChanges) => Promise<void>
  onRemove: (id: string) => Promise<void>
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [rating, setRating] = useState(book.rating ?? 5)
  const inputClass = 'mt-2 w-full rounded-xl border border-white/15 bg-black/25 px-3 py-2 text-white'
  const buttonClass = 'rounded-xl bg-[#c7ff36] px-4 py-2 text-sm font-semibold text-black disabled:opacity-50'

  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    return () => element?.close()
  }, [])

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setError('')
    const data = new FormData(event.currentTarget)
    let changes: BookChanges = {}

    if (view === 'edit') {
      const title = String(data.get('title')).trim()
      const author = String(data.get('author')).trim()
      if (!title || !author) {
        setError('Enter a book title and author.')
        return
      }
      changes = {
        title, author, mark: title.toUpperCase(), description: String(data.get('description')).trim() || null,
        tags: cleanTags(String(data.get('tags') ?? '').split(',')),
        series: String(data.get('series') ?? '').trim() || null,
      }
    } else if (view === 'progress') {
      const currentPage = Number(data.get('currentPage'))
      const totalPages = Number(data.get('totalPages'))
      if (!Number.isInteger(currentPage) || !Number.isInteger(totalPages) || currentPage < 0 || totalPages <= 0 || totalPages > 2147483647 || currentPage > totalPages) {
        setError('Enter a current page from zero through the total page count.')
        return
      }
      changes = {
        current_page: currentPage,
        total_pages: totalPages,
        progress: currentPage === totalPages ? 100 : Math.min(99, Math.round(currentPage / totalPages * 100)),
      }
    } else if (view === 'wishlist') {
      changes = { status: 'To Read' }
    } else if (view === 'rating') {
      if (book.rating !== null) {
        setError('This book already has a saved rating.')
        return
      }
      const submitter = (event.nativeEvent as SubmitEvent).submitter
      changes = { status: 'Read', progress: 100, current_page: book.total_pages, rating: submitter?.getAttribute('value') === 'skip' ? null : rating }
    }

    setBusy(true)
    try {
      if (view === 'remove') await onRemove(book.id)
      else await onUpdate(book.id, changes)
      onClose()
    } catch {
      setError(view === 'remove' ? 'Could not remove this book. Try again.' : 'Could not save your changes. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <dialog ref={dialog} aria-labelledby="book-dialog-heading" onCancel={(event) => { event.preventDefault(); if (!busy) onClose() }}
      className="fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-3xl border border-white/10 bg-[#171219] p-6 text-white backdrop:bg-black/75">
      <div className="mb-5 flex items-center justify-between gap-3">
        <h2 id="book-dialog-heading" className="font-display text-2xl font-semibold">{bookViewTitles[view]}</h2>
        <button type="button" aria-label="Close" disabled={busy} onClick={onClose} className="grid size-8 shrink-0 place-items-center rounded-full bg-white/10"><Icon name="close" size={16} /></button>
      </div>
      {view === 'details' ? (
        <>
          <div className="flex items-start gap-4">
            <div className="w-20 shrink-0"><Cover book={book} large /></div>
            <div className="min-w-0">
              <h3 className="break-words font-display text-xl font-semibold">{book.title}</h3>
              <p className="mt-1 text-sm text-white/60">{book.author}</p>
              <p className="mt-2 text-sm text-[#c7ff36]">{statusLabels[book.status]} · {book.progress}%</p>
              {book.rating !== null && <p className="mt-1 text-sm text-white/70">You rated this a {book.rating}/10</p>}
              {book.total_pages !== null && <p className="mt-1 text-sm text-white/70">Page {book.current_page} of {book.total_pages}</p>}
            </div>
          </div>
          {book.description && <p className="mt-5 whitespace-pre-wrap break-words text-sm leading-6 text-white/75">{book.description}</p>}
          {book.series && <p className="mt-4 text-sm text-white/70">Series · {book.series}</p>}
          {book.tags.length > 0 && <ul className="mt-4 flex flex-wrap gap-2">{book.tags.map((tag) =>
            <li key={tag} className="rounded-full bg-white/10 px-2.5 py-1 text-xs text-white/75">{tag}</li>,
          )}</ul>}
          {book.source_url && <a href={book.source_url} target="_blank" rel="noreferrer" className="mt-4 block text-sm text-[#c7ff36] underline">Book source</a>}
          <div className="mt-5 flex flex-wrap gap-3">
            <button type="button" onClick={() => onOpen('edit')} className="rounded-xl border border-white/15 px-4 py-2 text-sm">Edit details</button>
            {book.status === 'Read' && book.rating === null && <button type="button" onClick={() => onOpen('rating')} className="rounded-xl border border-white/15 px-4 py-2 text-sm">Rate book</button>}
          </div>
        </>
      ) : (
        <form onSubmit={save} className="space-y-4">
          {view === 'edit' && (
            <>
              <label className="block text-sm">Book title<input autoFocus required name="title" defaultValue={book.title} className={inputClass} /></label>
              <label className="block text-sm">Author<input required name="author" defaultValue={book.author} className={inputClass} /></label>
              <label className="block text-sm">Description<textarea name="description" maxLength={4000} rows={5} defaultValue={book.description ?? ''} className={inputClass} /></label>
              <label className="block text-sm">Series (optional)<input name="series" maxLength={120} defaultValue={book.series ?? ''} className={inputClass} /></label>
              <TagsField initialTags={book.tags} suggestions={tagSuggestions} />
            </>
          )}
          {view === 'rating' && (
            <label className="block text-sm">
              <span className="flex justify-between gap-3"><span>{book.title}</span><span className="font-semibold text-[#c7ff36]">{rating}/10</span></span>
              <input type="range" min={1} max={10} step={1} value={rating} onChange={(event) => setRating(event.target.valueAsNumber)}
                aria-label="Your rating" className="mt-3 w-full accent-[#c7ff36]" />
              <span className="mt-1 flex justify-between text-xs text-white/60"><span>1</span><span>10</span></span>
              <span className="mt-3 block text-xs text-white/60">Your rating is permanent once saved.</span>
            </label>
          )}
          {view === 'progress' && (
            <>
              <p className="text-sm text-white/70">{book.title} · {book.progress}%</p>
              <label className="block text-sm">Current page<input autoFocus required name="currentPage" type="number" min={0} max={2147483647} defaultValue={book.current_page ?? undefined} className={inputClass} /></label>
              <label className="block text-sm">Total pages<input required name="totalPages" type="number" min={1} max={2147483647} defaultValue={book.total_pages ?? undefined} className={inputClass} /></label>
            </>
          )}
          {view === 'wishlist' && <p className="text-sm text-white/75">Move <strong>{book.title}</strong> to your wishlist? Its reading progress will be saved.</p>}
          {view === 'remove' && <p className="text-sm text-white/75">Remove <strong>{book.title}</strong> and its reading progress from your library?</p>}
          {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
          <div className="flex flex-wrap justify-end gap-3">
            <button type="button" autoFocus={view === 'remove' || view === 'wishlist'} disabled={busy} onClick={onClose} className="rounded-xl border border-white/15 px-4 py-2 text-sm">Cancel</button>
            <button type="submit" disabled={busy} className={view === 'remove' ? 'rounded-xl bg-red-300 px-4 py-2 text-sm font-semibold text-black disabled:opacity-50' : buttonClass}>
              {busy ? 'Saving…' : view === 'remove' || view === 'wishlist' ? bookViewTitles[view] : view === 'rating' ? 'Save rating' : 'Save changes'}
            </button>
            {view === 'rating' && book.status !== 'Read' && (
              <button type="submit" value="skip" disabled={busy} className="rounded-xl border border-white/15 px-4 py-2 text-sm">Skip rating</button>
            )}
          </div>
        </form>
      )}
    </dialog>
  )
}

export default function App() {
  return <AuthGate>{(session) => <Library key={session.user.id} userId={session.user.id} />}</AuthGate>
}

function Library({ userId }: { userId: string }) {
  const [books, setBooks] = useState<Book[]>([])
  const [showFriends, setShowFriends] = useState(false)
  const [incomingRequests, setIncomingRequests] = useState(0)
  const [friendRequestRefresh, setFriendRequestRefresh] = useState(0)
  const refreshFriendRequests = useCallback(() => setFriendRequestRefresh((current) => current + 1), [])
  const [filter, setFilter] = useState<'All' | Status>('All')
  const [query, setQuery] = useState('')
  const [sortByStatus, setSortByStatus] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [draft, setDraft] = useState<Omit<BookMatch, 'id' | 'sourceUrl'> & { sourceUrl: string | null } | null>(null)
  const [keepCover, setKeepCover] = useState(true)
  const [duplicateId, setDuplicateId] = useState<string | null>(null)
  const [allowDuplicate, setAllowDuplicate] = useState(false)
  const [bookView, setBookView] = useState<{ id: string; view: BookView } | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [saveError, setSaveError] = useState('')
  const [saving, setSaving] = useState(false)
  const [signOutError, setSignOutError] = useState('')
  const [discovery, setDiscovery] = useState<{ reference: Book; matches: BookMatch[]; failed: boolean } | null>(null)
  const [openingDiscovery, setOpeningDiscovery] = useState<string | null>(null)
  const latestRating = useMemo(() => latestRatedBook(books), [books])
  const discoveryReference = latestRating && (latestRating.rating ?? 0) > 5 ? latestRating : null

  useEffect(() => {
    const client = supabase
    if (!client) return
    let pending: AbortController | undefined
    const checkRequests = async () => {
      pending?.abort()
      const controller = new AbortController()
      pending = controller
      const { count, error } = await client.from('friendships')
        .select('requested_by', { count: 'exact', head: true })
        .eq('accepted', false).neq('requested_by', userId)
        .abortSignal(controller.signal)
      if (!error && !controller.signal.aborted) setIncomingRequests(count ?? 0)
    }
    function checkWhenVisible() {
      if (document.visibilityState === 'visible') void checkRequests()
    }
    void checkRequests()
    const interval = window.setInterval(checkWhenVisible, 30000)
    window.addEventListener('focus', checkWhenVisible)
    document.addEventListener('visibilitychange', checkWhenVisible)
    return () => {
      pending?.abort()
      window.clearInterval(interval)
      window.removeEventListener('focus', checkWhenVisible)
      document.removeEventListener('visibilitychange', checkWhenVisible)
    }
  }, [userId, friendRequestRefresh])

  const friendBadge = incomingRequests > 0 && (
    <>
      <span aria-hidden="true" className="ml-2 inline-flex min-w-5 items-center justify-center rounded-full bg-[#c7ff36] px-1.5 py-0.5 text-[10px] font-bold leading-none text-black">{incomingRequests > 99 ? '99+' : incomingRequests}</span>
      <span className="sr-only">, {incomingRequests} incoming friend {incomingRequests === 1 ? 'request' : 'requests'}</span>
    </>
  )

  useEffect(() => {
    if (!discoveryReference) return
    const reference = discoveryReference
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 12000)
    let active = true
    discoverBooks(reference, controller.signal).then(
      (matches) => { if (active) setDiscovery({ reference, matches, failed: false }) },
      () => { if (active) setDiscovery({ reference, matches: [], failed: true }) },
    ).finally(() => window.clearTimeout(timeout))
    return () => {
      active = false
      window.clearTimeout(timeout)
      controller.abort()
    }
  }, [discoveryReference])

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
  const recommendations = useMemo(() => recommendBooks(books, latestRating), [books, latestRating])
  const discoveryResult = discovery?.reference === discoveryReference ? discovery : null
  const outsideRecommendations = useMemo(() => {
    if (!discoveryReference || !discoveryResult) return []
    const savedUrls = new Set(books.map((book) => book.source_url))
    const savedTitles = new Set(books.map((book) => catalogIdentity(book.title, book.author)))
    const candidates = discoveryResult.matches
      .filter((book) => !savedUrls.has(book.sourceUrl) && !savedTitles.has(catalogIdentity(book.title, book.author)))
      .map((book) => ({ ...book, status: 'Unread', rating: null, rated_at: null, source_url: book.sourceUrl }))
    return recommendBooks(candidates, discoveryReference)
  }, [books, discoveryReference, discoveryResult])
  const tagSuggestions = useMemo(() => cleanTags(books.flatMap((book) => book.tags)).sort((a, b) => a.localeCompare(b)), [books])

  const visibleBooks = books.filter((book) => {
    const matchesFilter = filter === 'All' ? book.status !== 'To Read' : book.status === filter
    const value = `${book.title} ${book.author}`.toLowerCase()
    return matchesFilter && value.includes(query.toLowerCase())
  })
  if (filter === 'All' && sortByStatus) {
    visibleBooks.sort((first, second) => statusPriority[first.status] - statusPriority[second.status])
  }

  async function updateBook(id: string, changes: BookChanges) {
    if (!supabase) throw new Error('Supabase is unavailable.')
    const { data, error } = await supabase.from('books').update(changes).eq('id', id).select('id, rated_at').single<Pick<Book, 'id' | 'rated_at'>>()
    if (error || !data) throw error ?? new Error('Book not found.')
    setBooks((current) => current.map((book) => book.id === id
      ? { ...book, ...changes, rated_at: 'rating' in changes ? data.rated_at : book.rated_at }
      : book))
  }

  async function removeBook(id: string) {
    if (!supabase) throw new Error('Supabase is unavailable.')
    const { data, error } = await supabase.from('books').delete().eq('id', id).select('id').maybeSingle()
    if (error) throw error
    if (!data) throw new Error('Book not found.')
    setBooks((current) => current.filter((book) => book.id !== id))
  }

  function findDuplicate(title: string, author: string, sourceUrl?: string | null) {
    const titleKey = normalizedBookText(title)
    const authorKey = normalizedBookText(author)
    return books.find((book) => (sourceUrl && book.source_url === sourceUrl) ||
      (authorKey && normalizedBookText(book.title) === titleKey && normalizedBookText(book.author) === authorKey))
  }

  function clearDuplicate() {
    setDuplicateId(null)
    setAllowDuplicate(false)
  }

  function chooseCatalogBook(book: BookMatch) {
    setKeepCover(true)
    setDuplicateId(findDuplicate(book.title, book.author, book.sourceUrl)?.id ?? null)
    setDraft(book)
  }

  async function openDiscoveryBook(book: BookMatch) {
    if (openingDiscovery) return
    setOpeningDiscovery(book.id)
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 8000)
    let selected = book
    try {
      selected = await loadBookMetadata(book, controller.signal)
    } catch {
      // The search metadata remains usable if the work lookup fails.
    } finally {
      window.clearTimeout(timeout)
      setOpeningDiscovery(null)
    }
    clearDuplicate()
    setSaveError('')
    chooseCatalogBook(selected)
    setShowAdd(true)
  }

  const duplicate = books.find((book) => book.id === duplicateId)
  const activeBook = books.find((book) => book.id === bookView?.id)

  function openDuplicate(book: Book) {
    setShowAdd(false)
    setFilter(book.status === 'To Read' ? 'To Read' : 'All')
    setQuery('')
    setBookView({ id: book.id, view: 'details' })
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
    if (!allowDuplicate) {
      const match = findDuplicate(title, author, draft?.sourceUrl)
      if (match) {
        setDuplicateId(match.id)
        setSaveError('')
        return
      }
    }
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
        tags: cleanTags(String(data.get('tags') ?? '').split(',')),
        series: String(data.get('series') ?? '').trim() || null,
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
          <div className={`relative mx-auto hidden w-full max-w-md ${showFriends ? '' : 'md:block'}`}>
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-white/35"><Icon name="search" size={18} /></span>
            <input value={query} onChange={(e) => setQuery(e.target.value)} className="h-10 w-full rounded-full border border-white/[0.08] bg-white/[0.045] pl-11 pr-4 text-sm outline-none transition focus:border-[#c7ff36]/60 focus:bg-white/[0.07]" placeholder="Search your library" />
          </div>
          <button aria-label="Add Book" disabled={loading || Boolean(loadError) || Boolean(openingDiscovery)} onClick={() => { setShowFriends(false); setSaveError(''); clearDuplicate(); setDraft(null); setShowAdd(true) }} className="ml-auto flex h-10 items-center gap-2 rounded-full bg-[#c7ff36] px-4 text-sm font-semibold text-[#111] transition hover:bg-[#dbff79] active:scale-[.98]">
            <Icon name="plus" size={17} /><span className="hidden sm:inline">Add Book</span>
          </button>
          <button onClick={signOut} className="shrink-0 text-xs text-white/60 hover:text-white">Sign out</button>
        </div>
        {showFriends && signOutError && <p role="alert" className="px-5 pb-2 text-sm text-red-300">{signOutError}</p>}
      </header>

      <main className="mx-auto flex min-h-screen max-w-[1500px] flex-col pt-[72px] lg:flex-row">
        <nav aria-label="Library and friends" className="flex gap-2 border-b border-white/10 px-5 py-3 lg:hidden">
          <button type="button" onClick={() => setShowFriends(false)} aria-current={!showFriends ? 'page' : undefined} className={`rounded-full px-4 py-2 text-sm ${showFriends ? 'text-white/60' : 'bg-[#372443] text-white'}`}>Library</button>
          <button type="button" onClick={() => setShowFriends(true)} aria-current={showFriends ? 'page' : undefined} className={`rounded-full px-4 py-2 text-sm ${showFriends ? 'bg-[#372443] text-white' : 'text-white/60'}`}>Friends{friendBadge}</button>
        </nav>
        <aside className="hidden w-[242px] shrink-0 border-r border-white/[0.07] px-5 py-8 lg:block">
          <p className="mb-3 px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/30">Library</p>
          {[
            { label: 'All books', value: 'All', icon: 'grid' },
            { label: 'Reading now', value: 'Reading', icon: 'clock' },
            { label: statusLabels['To Read'], value: 'To Read', icon: 'bookmark' },
            { label: 'Finished', value: 'Read', icon: 'check' },
          ].map((item) => (
            <button key={item.value} onClick={() => { setShowFriends(false); setFilter(item.value as 'All' | Status) }} className={`mb-1 flex h-11 w-full items-center gap-3 rounded-lg px-3 text-sm transition ${!showFriends && filter === item.value ? 'bg-[#372443] text-white' : 'text-white/50 hover:bg-white/[0.04] hover:text-white'}`}>
              <span className={!showFriends && filter === item.value ? 'text-[#c7ff36]' : ''}><Icon name={item.icon as 'grid'} size={17} /></span>
              <span>{item.label}</span><span className="ml-auto text-xs text-white/25">{counts[item.value as keyof typeof counts]}</span>
            </button>
          ))}
          <button type="button" aria-current={showFriends ? 'page' : undefined} onClick={() => setShowFriends(true)} className={`mt-3 flex h-11 w-full items-center gap-3 rounded-lg px-3 text-sm ${showFriends ? 'bg-[#372443] text-white' : 'text-white/50 hover:bg-white/[0.04] hover:text-white'}`}>
            <span className={showFriends ? 'text-[#c7ff36]' : ''}><Icon name="friends" size={17} /></span><span>Friends{friendBadge}</span>
          </button>
        </aside>

        {showFriends ? <Friends userId={userId} onRequestsChanged={refreshFriendRequests} /> : <section className="min-w-0 flex-1 px-5 pb-14 pt-8 md:px-9 md:pt-11 xl:px-12">
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

          {!loading && !loadError && filter === 'All' && !query.trim() && books.length > 0 && (
            <section aria-labelledby="recommendations-heading" className="mb-8 rounded-2xl border border-white/10 bg-white/[0.035] p-4 sm:p-5">
              <h2 id="recommendations-heading" className="font-display text-lg font-semibold">Recommended for you</h2>
              <h3 className="mt-4 text-sm font-semibold">From your collection</h3>
              {recommendations.length ? (
                <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                  {recommendations.map(({ book, reason }) => (
                    <li key={book.id}>
                      <button type="button" onClick={() => setBookView({ id: book.id, view: 'details' })}
                        className="flex w-full items-center gap-3 rounded-lg p-2 text-left hover:bg-white/[0.07] focus-visible:outline-[#c7ff36]">
                        <Cover book={book} />
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold">{book.title}</span>
                          <span className="mt-1 block text-xs text-white/65">{reason}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : <p className="mt-2 text-sm text-white/60">{discoveryReference ? 'No matching unread books in your collection.' : 'Rate a book above 5/10 to see similar titles.'}</p>}
              <h3 className="mt-5 border-t border-white/10 pt-4 text-sm font-semibold">Discover Warhammer books</h3>
              {outsideRecommendations.length ? (
                <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                  {outsideRecommendations.map(({ book, reason }) => (
                    <li key={book.id}>
                      <button type="button" disabled={Boolean(openingDiscovery)} onClick={() => void openDiscoveryBook(book)}
                        className="flex w-full items-center gap-3 rounded-lg p-2 text-left hover:bg-white/[0.07] focus-visible:outline-[#c7ff36]">
                        <span className="h-[72px] w-12 shrink-0 overflow-hidden rounded bg-white/10">
                          {book.coverUrl && <img src={book.coverUrl} alt="" loading="lazy" referrerPolicy="no-referrer" className="size-full object-cover" />}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold">{book.title}</span>
                          <span className="mt-1 block text-xs text-white/65">{openingDiscovery === book.id ? 'Loading book details…' : reason}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p role="status" className="mt-2 text-sm text-white/60">
                  {!discoveryReference ? 'Discover titles outside your collection after your next qualifying rating.'
                    : !discoveryResult ? 'Looking for similar Warhammer books…'
                    : discoveryResult.failed ? 'Open Library is unavailable right now.'
                    : 'No matching Warhammer titles outside your collection and wishlist.'}
                </p>
              )}
            </section>
          )}

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
                <BookCard key={book.id} book={book} onUpdate={updateBook} onOpen={(view) => setBookView({ id: book.id, view })} />
              ))}
            </div>
          ) : (
            <div className="flex min-h-[360px] flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-white/[0.02] text-center">
              <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-[#32203d] text-[#c7ff36]"><Icon name="book" /></div>
              <h2 className="font-display text-xl font-semibold">{query.trim() ? 'No books found' : filter === 'To Read' ? 'Your wishlist is empty' : 'No books here yet'}</h2>
              <p className="mt-2 text-sm text-white/35">{query.trim() ? 'Try another search.' : 'Use Add Book to add a title.'}</p>
            </div>
          )}
        </section>}
      </main>

      {bookView && activeBook && (
        <BookDialog key={`${bookView.id}:${bookView.view}`} book={activeBook} view={bookView.view} tagSuggestions={tagSuggestions}
          onClose={() => setBookView(null)} onOpen={(view) => setBookView({ id: activeBook.id, view })}
          onUpdate={updateBook} onRemove={removeBook} />
      )}

      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 p-0 backdrop-blur-sm sm:items-center sm:p-5" onMouseDown={() => { if (!saving) setShowAdd(false) }}>
          <div role="dialog" aria-modal="true" aria-labelledby="add-book-heading" className="max-h-[100dvh] w-full max-w-lg overflow-y-auto rounded-t-[24px] border border-white/10 bg-[#171219] p-6 shadow-2xl sm:rounded-[24px] sm:p-8" onMouseDown={(e) => e.stopPropagation()}>
            <div className="mb-7 flex items-start justify-between">
              <h2 id="add-book-heading" className="font-display text-3xl font-semibold tracking-[-0.035em]">Add Book</h2>
              <button aria-label="Close" disabled={saving} onClick={() => setShowAdd(false)} className="flex size-9 items-center justify-center rounded-full bg-white/[0.06] text-white/50 hover:text-white"><Icon name="close" size={18} /></button>
            </div>
            {!draft ? (
              <BookSearch onChoose={chooseCatalogBook}
                onCustom={(title) => setDraft({ title, author: '', description: '', tags: [], series: null, coverUrl: null, sourceUrl: null })} />
            ) : <form onSubmit={addBook}>
              <button type="button" disabled={saving} onClick={() => { setSaveError(''); clearDuplicate(); setDraft(null) }} className="mb-4 text-sm text-[#c7ff36]">Back to search</button>
              {duplicate && (
                <div role="status" className="mb-4 rounded-xl border border-[#c7ff36]/30 bg-[#c7ff36]/5 p-3 text-sm">
                  <p><strong>{duplicate.title}</strong> is already in {duplicate.status === 'To Read' ? 'your wishlist' : 'your collection'}.</p>
                  <div className="mt-2 flex flex-wrap gap-4">
                    <button type="button" onClick={() => openDuplicate(duplicate)} className="text-[#c7ff36] underline">Open existing book</button>
                    {!allowDuplicate && <button type="button" onClick={() => setAllowDuplicate(true)} className="text-white/70 underline">Allow another copy</button>}
                  </div>
                  {allowDuplicate && <p className="mt-2 text-white/70">You can now save another copy.</p>}
                </div>
              )}
              <label className="mb-5 block"><span className="mb-2 block text-xs font-medium text-white/45">Book title</span><input required autoFocus name="title" defaultValue={draft.title} onChange={clearDuplicate} placeholder="e.g. The Dispossessed" className="h-12 w-full rounded-xl border border-white/10 bg-black/25 px-4 text-sm outline-none transition placeholder:text-white/20 focus:border-[#c7ff36]/60" /></label>
              <label className="mb-5 block"><span className="mb-2 block text-xs font-medium text-white/45">Author</span><input required name="author" defaultValue={draft.author} onChange={clearDuplicate} placeholder="Author’s name" className="h-12 w-full rounded-xl border border-white/10 bg-black/25 px-4 text-sm outline-none transition placeholder:text-white/20 focus:border-[#c7ff36]/60" /></label>
              <label className="mb-5 block"><span className="mb-2 block text-xs font-medium text-white/45">Description (optional)</span><textarea name="description" defaultValue={draft.description} maxLength={4000} rows={3} className="w-full rounded-xl border border-white/10 bg-black/25 px-4 py-3 text-sm outline-none focus:border-[#c7ff36]/60" /></label>
              <label className="mb-5 block"><span className="mb-2 block text-xs font-medium text-white/45">Series (optional)</span><input name="series" maxLength={120} defaultValue={draft.series ?? ''} className="h-12 w-full rounded-xl border border-white/10 bg-black/25 px-4 text-sm outline-none focus:border-[#c7ff36]/60" /></label>
              <TagsField initialTags={draft.tags} suggestions={tagSuggestions} />
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
