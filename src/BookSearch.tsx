import { useEffect, useRef, useState } from 'react'
import { type BookMatch, loadBookDescription, searchBooks } from './openLibrary'

export default function BookSearch({ onChoose, onCustom }: {
  onChoose: (book: BookMatch) => void
  onCustom: (title: string) => void
}) {
  const [title, setTitle] = useState('')
  const [lookup, setLookup] = useState<{ title: string; matches: BookMatch[]; failed: boolean } | null>(null)
  const [loadingBook, setLoadingBook] = useState(false)
  const selection = useRef<AbortController | null>(null)
  const query = title.trim()
  const result = lookup?.title === query ? lookup : null

  useEffect(() => {
    if (query.length < 2) return
    const controller = new AbortController()
    const timeout = window.setTimeout(async () => {
      try {
        const matches = await searchBooks(query, controller.signal)
        if (!controller.signal.aborted) setLookup({ title: query, matches, failed: false })
      } catch {
        if (!controller.signal.aborted) setLookup({ title: query, matches: [], failed: true })
      }
    }, 1000)
    return () => {
      window.clearTimeout(timeout)
      controller.abort()
    }
  }, [query])

  useEffect(() => () => {
    selection.current?.abort()
    selection.current = null
  }, [])

  async function chooseBook(book: BookMatch) {
    const controller = new AbortController()
    selection.current = controller
    setLoadingBook(true)
    let description = ''
    const timeout = window.setTimeout(() => controller.abort(), 8000)
    try {
      description = await loadBookDescription(book, controller.signal)
    } catch {
      // The search result is still usable if the description is unavailable.
    } finally {
      window.clearTimeout(timeout)
    }
    if (selection.current === controller) onChoose({ ...book, description })
  }

  return (
    <div>
      <label className="block">
        <span className="mb-2 block text-xs font-medium text-white/60">Search by book title</span>
        <input type="search" autoFocus value={title} maxLength={200} disabled={loadingBook}
          onChange={(event) => {
            const nextTitle = event.target.value
            if (nextTitle.trim() !== query) setLookup(null)
            setTitle(nextTitle)
          }}
          placeholder="Enter a book title"
          className="h-12 w-full rounded-xl border border-white/10 bg-black/25 px-4 text-sm outline-none focus:border-[#c7ff36]/60" />
      </label>
      {query.length >= 2 && (
        <div className="mt-4" aria-live="polite">
          {!result && <p className="text-sm text-white/60">Searching…</p>}
          {result?.failed && <p className="text-sm text-white/60">Book search is unavailable right now. You can still add a custom book.</p>}
          {result && !result.failed && !result.matches.length && <p className="text-sm text-white/60">No matching books found.</p>}
          {!!result?.matches.length && (
            <ul className="max-h-[40dvh] space-y-2 overflow-y-auto">
              {result.matches.map((book) => (
                <li key={book.id}>
                  <button type="button" disabled={loadingBook} onClick={() => void chooseBook(book)} className="flex w-full items-center gap-3 rounded-xl bg-white/[0.05] p-2 text-left hover:bg-white/10">
                    <span className="h-14 w-10 shrink-0 overflow-hidden rounded bg-white/10">
                      {book.coverUrl && <img src={book.coverUrl} alt="" referrerPolicy="no-referrer" className="size-full object-cover" />}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold">{book.title}</span>
                      <span className="block truncate text-xs text-white/60">{book.author}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {loadingBook && <p role="status" className="mt-3 text-sm text-white/60">Loading book details…</p>}
      <button type="button" disabled={loadingBook} onClick={() => onCustom(query)} className="mt-5 text-sm font-semibold text-[#c7ff36]">Add a custom book</button>
    </div>
  )
}
