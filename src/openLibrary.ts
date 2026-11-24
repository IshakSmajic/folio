const catalog = 'https://openlibrary.org'

export type BookMatch = {
  id: string
  title: string
  author: string
  description: string
  coverUrl: string | null
  sourceUrl: string
}

type SearchResult = { key: string; title: string; author_name?: string[]; cover_i?: number }

async function fetchCatalog<T>(path: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(catalog + path, { signal })
  if (!response.ok) throw new Error(`Book lookup returned ${response.status}.`)
  return response.json()
}

export async function searchBooks(title: string, signal: AbortSignal): Promise<BookMatch[]> {
  const params = new URLSearchParams({ title, fields: 'key,title,author_name,cover_i', limit: '8' })
  const { docs } = await fetchCatalog<{ docs: SearchResult[] }>(`/search.json?${params}`, signal)
  return docs.filter((book) => /^\/works\/OL\d+W$/.test(book.key)).map((book) => ({
    id: book.key,
    title: book.title,
    author: book.author_name?.join(', ') ?? '',
    description: '',
    coverUrl: book.cover_i ? `https://covers.openlibrary.org/b/id/${book.cover_i}-L.jpg?default=false` : null,
    sourceUrl: catalog + book.key,
  }))
}

export async function loadBookDescription(book: BookMatch, signal: AbortSignal): Promise<string> {
  const { description } = await fetchCatalog<{ description?: string | { value: string } }>(`${book.id}.json`, signal)
  const text = typeof description === 'string' ? description : description?.value
  return text?.trim().slice(0, 4000) ?? ''
}
