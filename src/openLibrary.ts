import { cleanTags } from './recommendations'

const catalog = 'https://openlibrary.org'
const warhammerScope = '(subject:warhammer OR subject:"horus heresy" OR publisher:"Black Library" OR publisher:"Games Workshop")'
const genericSubjects = /^(?:accessible book|protected daisy|internet archive|fiction|general|in library|science fiction|fantasy|games workshop|(?:the )?black library|warhammer(?:\s*(?:40k|40,?000))?(?:\s*\(game\))?)$/i

export type BookMatch = {
  id: string
  title: string
  author: string
  description: string
  tags: string[]
  series: string | null
  coverUrl: string | null
  sourceUrl: string
}

type SearchResult = {
  key: string
  title: string
  author_name?: string[]
  cover_i?: number
  subject?: string[]
  first_sentence?: string[]
}

async function fetchCatalog<T>(path: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(catalog + path, { signal })
  if (!response.ok) throw new Error(`Book lookup returned ${response.status}.`)
  return response.json()
}

function searchPhrase(value: string) {
  return `"${value.replace(/["\\]/g, ' ').trim()}"`
}

function subjectTags(subjects: string[] = []) {
  return cleanTags(subjects.filter((subject) => typeof subject === 'string' && subject.length <= 60 &&
    !genericSubjects.test(subject.trim())))
}

export function catalogIdentity(title: string, author: string) {
  const normalize = (text: string) => text.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
  const titleKey = normalize(title.replace(/\s*[:(].*$/, '')).join(' ')
  return `${titleKey}|${normalize(author).sort().join(' ')}`
}

async function searchWarhammer(query: string, limit: number, signal: AbortSignal): Promise<BookMatch[]> {
  const params = new URLSearchParams({
    q: `${warhammerScope} AND (${query})`,
    fields: 'key,title,author_name,cover_i,subject,first_sentence',
    limit: String(limit),
  })
  const { docs } = await fetchCatalog<{ docs: SearchResult[] }>(`/search.json?${params}`, signal)
  const matches = docs.filter((book) => /^\/works\/OL\d+W$/.test(book.key)).map((book) => ({
    id: book.key,
    title: book.title.trim().replace(/\s+/g, ' '),
    author: book.author_name?.join(', ') ?? '',
    description: book.first_sentence?.[0]?.slice(0, 4000) ?? '',
    tags: subjectTags(book.subject),
    series: book.subject?.find((subject) => /^(?:the )?horus heresy$|\bseries$/i.test(subject)) ?? null,
    coverUrl: book.cover_i ? `https://covers.openlibrary.org/b/id/${book.cover_i}-L.jpg?default=false` : null,
    sourceUrl: catalog + book.key,
  }))
  const unique = new Map<string, BookMatch>()
  for (const book of matches) {
    const identity = catalogIdentity(book.title, book.author)
    const previous = unique.get(identity)
    if (!previous || (!previous.coverUrl && book.coverUrl)) unique.set(identity, book)
  }
  return [...unique.values()]
}

export async function searchBooks(title: string, signal: AbortSignal) {
  const phrase = searchPhrase(title)
  const results = await searchWarhammer(`title:${phrase}`, 15, signal)
  const titleKey = catalogIdentity(title, '')
  return results.sort((first, second) =>
    Number(catalogIdentity(second.title, '') === titleKey) - Number(catalogIdentity(first.title, '') === titleKey),
  ).slice(0, 8)
}

export async function discoverBooks(reference: { author: string; tags: string[]; series: string | null }, signal: AbortSignal) {
  const subjects = subjectTags(reference.tags).slice(0, 5)
  if (reference.series) subjects.unshift(reference.series)
  const clauses = subjects.map((subject) => `subject:${searchPhrase(subject)}`)
  if (reference.author) clauses.push(`author:${searchPhrase(reference.author)}`)
  if (!clauses.length) return []
  const books = await searchWarhammer(clauses.join(' OR '), 30, signal)
  return books.filter((book) => !/\b(?:box\s*set|omnibus|codex|rulebook|army book)\b/i.test(book.title))
}

type Description = string | { value: string }

function descriptionText(description?: Description) {
  const text = typeof description === 'string' ? description : description?.value
  return text?.trim().slice(0, 4000) ?? ''
}

export async function loadBookMetadata(book: BookMatch, signal: AbortSignal): Promise<BookMatch> {
  const work = await fetchCatalog<{ description?: Description; subjects?: string[] }>(`${book.id}.json`, signal)
  const workTags = subjectTags(work.subjects)
  const tags = (workTags.length ? workTags : book.tags).slice(0, 8)
  const description = descriptionText(work.description)
  if (description) return { ...book, description, tags }

  try {
    const { entries } = await fetchCatalog<{ entries: { description?: Description; series?: string[] }[] }>(
      `${book.id}/editions.json?limit=5`, signal,
    )
    const edition = entries.find((item) => descriptionText(item.description))
    const series = (edition?.series ?? entries.find((item) => item.series?.length)?.series)?.[0]
    return { ...book, tags, description: descriptionText(edition?.description) || book.description, series: series?.trim().slice(0, 120) || book.series }
  } catch {
    return { ...book, tags }
  }
}
