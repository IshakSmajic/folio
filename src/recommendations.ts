type RecommendationBook = {
  id: string
  title: string
  author: string
  description: string | null
  tags: string[]
  series: string | null
  rating: number | null
  rated_at: string | null
  status: string
  source_url: string | null
}

const commonWords = new Set(
  'about after again against also among another back because been before being between book both could does down during each every first from further have here into itself just like make many more most much must never next novel once only other over same some story such take than that them then there these they this those through thus under upon very were what when where which while will with within without would your'.split(' '),
)

export function normalizeTag(tag: string) {
  return tag.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase()
}

export function cleanTags(tags: string[]) {
  const result = new Map<string, string>()
  for (const rawTag of tags) {
    const tag = rawTag.trim().replace(/\s+/g, ' ').slice(0, 60)
    const key = normalizeTag(tag)
    if (key && !result.has(key)) result.set(key, tag)
    if (result.size === 20) break
  }
  return [...result.values()]
}

function descriptionTerms(description: string | null) {
  const words = (description ?? '').normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
  const terms = new Map<string, number>()
  for (const [index, word] of words.entries()) {
    if (word.length < 3 || commonWords.has(word)) continue
    terms.set(word, (terms.get(word) ?? 0) + 1)
    const next = words[index + 1]
    if (next && next.length >= 3 && !commonWords.has(next)) {
      const phrase = `${word} ${next}`
      terms.set(phrase, (terms.get(phrase) ?? 0) + 1)
    }
  }
  return terms
}

function cosine(first: Map<string, number>, second: Map<string, number>) {
  let dot = 0
  for (const [term, weight] of first) dot += weight * (second.get(term) ?? 0)
  return dot
}

export function latestRatedBook<T extends RecommendationBook>(books: T[]) {
  // The library is ordered newest first, which breaks ties for ratings saved before timestamps existed.
  return books.reduce<T | undefined>((latest, book) => {
    if (book.rating === null) return latest
    return !latest || (book.rated_at ?? '') > (latest.rated_at ?? '') ? book : latest
  }, undefined)
}

export function recommendBooks<T extends RecommendationBook>(books: T[], reference = latestRatedBook<RecommendationBook>(books)) {
  if (!reference || reference.rating === null || reference.rating <= 5) return []

  const unread = books.filter((book) => book.status === 'Unread' && book.id !== reference.id &&
    (!book.source_url || book.source_url !== reference.source_url))
  if (!unread.length) return []
  const candidates = [reference, ...unread]
  const termCounts = candidates.map((book) => descriptionTerms(book.description))
  const frequency = new Map<string, number>()
  for (const counts of termCounts) {
    for (const term of counts.keys()) frequency.set(term, (frequency.get(term) ?? 0) + 1)
  }
  const descriptions = new Map(candidates.map((book, index) => {
    const weights = new Map<string, number>()
    for (const [term, count] of termCounts[index]) {
      const inverseFrequency = Math.log((candidates.length + 1) / (frequency.get(term)! + 1)) + 1
      weights.set(term, (1 + Math.log(count)) * inverseFrequency)
    }
    const magnitude = Math.sqrt(cosine(weights, weights))
    for (const [term, weight] of weights) weights.set(term, weight / magnitude)
    return [book.id, weights] as const
  }))
  const referenceTags = new Set(reference.tags.map(normalizeTag))
  const referenceAuthor = normalizeTag(reference.author)
  const referenceSeries = normalizeTag(reference.series ?? '')
  const ratingWeight = (reference.rating - 5.5) / 4.5
  const rating = `${reference.title} (${reference.rating}/10)`

  return unread.flatMap((book) => {
    const author = normalizeTag(book.author)
    const series = normalizeTag(book.series ?? '')
    const sharedTags = cleanTags(book.tags).filter((tag) => referenceTags.has(normalizeTag(tag)))
    const similarity = cosine(descriptions.get(book.id)!, descriptions.get(reference.id)!)
    const sameSeries = Boolean(series && series === referenceSeries)
    const sameAuthor = Boolean(author && author === referenceAuthor)
    const descriptionWeight = similarity >= 0.12 ? similarity : 0
    const score = (descriptionWeight + Math.min(sharedTags.length, 4) * 0.32 +
      (sameSeries ? 0.24 : 0) + (sameAuthor ? 0.09 : 0)) * ratingWeight
    if (score <= 0) return []

    let reason: string
    if (sharedTags.length) reason = `Shares ${sharedTags.slice(0, 2).join(' and ')} with ${rating}`
    else if (descriptionWeight >= 0.24 || (!sameSeries && !sameAuthor)) reason = `Description similar to ${rating}`
    else if (sameSeries) reason = `Same series as ${rating}`
    else reason = `Same author as ${rating}`
    return [{ book, score, reason }]
  }).sort((first, second) => second.score - first.score).slice(0, 3)
}
