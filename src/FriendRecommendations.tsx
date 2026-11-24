import { type FormEvent, useEffect, useRef, useState } from 'react'
import type { SharedBook } from './Friends'
import { supabase } from './supabase'

type Recipient = { user_id: string; username: string }
type Message = SharedBook & {
  sender_id: string
  recipient_id: string
  sender_username: string
  recipient_username: string
  rating: number
  created_at: string
  read_at: string | null
}

const messageFields = 'id, sender_id, recipient_id, sender_username, recipient_username, title, author, rating, cover_photo, cover_url, created_at, read_at'
const pageSize = 48
const primaryClass = 'rounded-xl bg-[#c7ff36] px-4 py-2 text-sm font-semibold text-black disabled:opacity-50'
const secondaryClass = 'rounded-xl border border-white/15 px-3 py-2 text-sm hover:bg-white/10 disabled:opacity-50'
const messageTime = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })
const messageDate = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' })

function FriendInitial({ name, selected = false }: { name: string; selected?: boolean }) {
  return (
    <span aria-hidden="true" className={`grid size-9 shrink-0 place-items-center rounded-full text-sm font-semibold uppercase ${selected ? 'bg-[#c7ff36]/15 text-[#d5fa77]' : 'bg-[#292130] text-[#d6bddf]'}`}>
      {name.slice(0, 1)}
    </span>
  )
}

function RecommendationCard({ message, own, onChooseBook }: { message: Message; own: boolean; onChooseBook: (book: SharedBook) => void }) {
  const cover = message.cover_photo ?? message.cover_url
  return (
    <article className={`w-full max-w-[26rem] rounded-2xl border p-3 sm:p-4 ${own ? 'border-[#433246] bg-[#221926]' : 'border-white/10 bg-[#19161c]'}`}>
      <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="min-w-0 break-words text-xs text-white/65"><strong className="font-semibold text-white">@{message.sender_username}</strong> recommends this book!</p>
        <time dateTime={message.created_at} className="text-[11px] tabular-nums text-white/55">{messageTime.format(new Date(message.created_at))}</time>
      </header>
      <button type="button" aria-label={`Add ${message.title} to your library`} onClick={() => onChooseBook(message)}
        className="group mt-3 flex w-full items-center gap-3 rounded-xl border border-white/10 bg-black/20 p-2 text-left transition hover:border-[#c7ff36]/40 hover:bg-[#c7ff36]/5 focus-visible:outline-[#c7ff36] sm:gap-4">
        <span className="relative grid aspect-[2/3] w-11 shrink-0 place-items-center overflow-hidden rounded-md bg-[#372840] sm:w-14">
          <span aria-hidden="true" className="font-display text-lg font-semibold text-[#d6bddf]">{message.title.slice(0, 1)}</span>
          {cover && <img src={cover} alt="" loading="lazy" referrerPolicy="no-referrer" className="absolute inset-0 size-full object-cover" onError={(event) => { event.currentTarget.hidden = true }} />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block break-words font-display text-sm font-semibold leading-snug">{message.title}</span>
          <span className="mt-1 block break-words text-xs text-white/60">{message.author}</span>
          <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-[#c7ff36]/10 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-[#d5fa77]"><span aria-hidden="true">★</span> {message.rating}/10</span>
        </span>
        <span aria-hidden="true" className="grid size-7 shrink-0 place-items-center rounded-full border border-white/15 text-base text-white/65 transition group-hover:border-[#c7ff36]/40 group-hover:text-[#c7ff36]">+</span>
      </button>
    </article>
  )
}

export function RecommendationComposer({ userId, bookId, title, rating, onDone }: {
  userId: string
  bookId: string
  title: string
  rating: number
  onDone: () => void
}) {
  const [friends, setFriends] = useState<Recipient[]>([])
  const [recipient, setRecipient] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    const client = supabase
    if (!client) return
    const controller = new AbortController()
    const loadRecipients = async () => {
      try {
        const { data, error } = await client.from('friendships')
          .select('low:friend_profiles!friendships_user_low_fkey(user_id, username), high:friend_profiles!friendships_user_high_fkey(user_id, username)')
          .eq('accepted', true).abortSignal(controller.signal)
          .returns<{ low: Recipient; high: Recipient }[]>()
        if (error) throw error
        if (controller.signal.aborted) return
        setFriends(data.map(({ low, high }) => low.user_id === userId ? high : low)
          .sort((first, second) => first.username.localeCompare(second.username)))
      } catch {
        if (!controller.signal.aborted) setError('Could not load your friends.')
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }
    void loadRecipients()
    return () => controller.abort()
  }, [userId])

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || !recipient || busy) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const { data, error } = await supabase.rpc('send_friend_book_recommendation', { target_friend: recipient, target_book: bookId })
      if (error) throw error
      const friend = friends.find((item) => item.user_id === recipient)
      setNotice(data ? `Recommendation sent to @${friend?.username}.` : 'You already recommended this book to that friend.')
    } catch {
      setError('Could not send the recommendation. Make sure this person is still your friend.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={send} className="space-y-4">
      <p className="text-sm text-white/75">Share <strong>{title}</strong> and your {rating}/10 rating with a friend.</p>
      {loading && <p role="status" className="text-sm text-white/60">Loading friends…</p>}
      {!loading && !error && !friends.length && <p className="text-sm text-white/60">Add a friend before sending recommendations.</p>}
      {friends.length > 0 && (
        <label className="block text-sm">Choose a friend
          <select required value={recipient} onChange={(event) => { setRecipient(event.target.value); setNotice('') }}
            className="mt-2 w-full rounded-xl border border-white/15 bg-[#171219] px-3 py-2 text-white">
            <option value="">Select a friend</option>
            {friends.map((friend) => <option key={friend.user_id} value={friend.user_id}>@{friend.username}</option>)}
          </select>
        </label>
      )}
      {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
      {notice && <p role="status" className="text-sm text-[#c7ff36]">{notice}</p>}
      <div className="flex flex-wrap justify-end gap-3">
        <button type="button" onClick={onDone} className={secondaryClass}>Done</button>
        {friends.length > 0 && <button type="submit" disabled={!recipient || busy} className={primaryClass}>{busy ? 'Sending…' : 'Send recommendation'}</button>}
      </div>
    </form>
  )
}

export default function FriendRecommendations({ userId, onUnreadChanged, onChooseBook }: {
  userId: string
  onUnreadChanged: () => void
  onChooseBook: (book: SharedBook) => void
}) {
  const [messages, setMessages] = useState<Message[]>([])
  const [activeFriend, setActiveFriend] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [hasEarlier, setHasEarlier] = useState(false)
  const [loadingEarlier, setLoadingEarlier] = useState(false)
  const [error, setError] = useState('')
  const [readError, setReadError] = useState(false)
  const [retry, setRetry] = useState(0)
  const exhaustedHistory = useRef(false)
  const chatHistory = useRef<HTMLOListElement>(null)

  useEffect(() => {
    const client = supabase
    if (!client) return
    let pending: AbortController | undefined
    const load = async () => {
      if (document.visibilityState === 'hidden') return
      pending?.abort()
      const controller = new AbortController()
      pending = controller
      try {
        const { data, error } = await client.from('friend_book_recommendations').select(messageFields)
          .order('created_at', { ascending: false }).order('id', { ascending: false })
          .limit(pageSize).abortSignal(controller.signal).returns<Message[]>()
        if (error) throw error
        if (controller.signal.aborted) return
        setMessages((current) => {
          const ids = new Set(data.map((message) => message.id))
          const earliest = data[data.length - 1]?.created_at
          return [...data, ...current.filter((message) => earliest && message.created_at <= earliest && !ids.has(message.id))]
        })
        const unread = data.find((message) => message.recipient_id === userId && message.read_at === null)
        const latest = data[0]
        setActiveFriend((current) => current ?? unread?.sender_id ??
          (latest ? (latest.sender_id === userId ? latest.recipient_id : latest.sender_id) : null))
        setHasEarlier(data.length === pageSize && !exhaustedHistory.current)
        setError('')
      } catch {
        if (!controller.signal.aborted) setError('Could not load recommendations.')
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }
    void load()
    const interval = window.setInterval(load, 30000)
    window.addEventListener('focus', load)
    document.addEventListener('visibilitychange', load)
    return () => {
      pending?.abort()
      window.clearInterval(interval)
      window.removeEventListener('focus', load)
      document.removeEventListener('visibilitychange', load)
    }
  }, [retry, userId])

  const threads = new Map<string, { name: string; messages: Message[]; unread: number }>()
  for (const message of messages) {
    const incoming = message.recipient_id === userId
    const friend = incoming ? message.sender_id : message.recipient_id
    const name = incoming ? message.sender_username : message.recipient_username
    const thread = threads.get(friend) ?? { name, messages: [], unread: 0 }
    thread.messages.push(message)
    if (incoming && message.read_at === null) thread.unread++
    threads.set(friend, thread)
  }
  const activeThread = activeFriend ? threads.get(activeFriend) : undefined
  const chronological = activeThread ? [...activeThread.messages].reverse() : []
  const unreadKey = activeThread?.messages.filter((message) => message.recipient_id === userId && message.read_at === null)
    .map((message) => message.id).join(',') ?? ''

  useEffect(() => {
    const history = chatHistory.current
    if (history) history.scrollTop = history.scrollHeight
  }, [activeFriend])

  useEffect(() => {
    const client = supabase
    if (!client || !unreadKey || readError) return
    const controller = new AbortController()
    const ids = unreadKey.split(',')
    const markRead = async () => {
      if (document.visibilityState === 'hidden') return
      const now = new Date().toISOString()
      const { error } = await client.from('friend_book_recommendations').update({ read_at: now })
        .in('id', ids).eq('recipient_id', userId).is('read_at', null).abortSignal(controller.signal)
      if (controller.signal.aborted) return
      if (error) {
        setReadError(true)
        return
      }
      const readIds = new Set(ids)
      setMessages((current) => current.map((message) => readIds.has(message.id) ? { ...message, read_at: now } : message))
      onUnreadChanged()
    }
    void markRead()
    document.addEventListener('visibilitychange', markRead)
    return () => {
      controller.abort()
      document.removeEventListener('visibilitychange', markRead)
    }
  }, [onUnreadChanged, readError, unreadKey, userId])

  async function loadEarlier() {
    const earliest = messages[messages.length - 1]
    if (!supabase || !earliest || loadingEarlier) return
    setLoadingEarlier(true)
    try {
      const { data, error } = await supabase.from('friend_book_recommendations').select(messageFields)
        .or(`created_at.lt.${earliest.created_at},and(created_at.eq.${earliest.created_at},id.lt.${earliest.id})`)
        .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(pageSize).returns<Message[]>()
      if (error) throw error
      setMessages((current) => {
        const ids = new Set(current.map((message) => message.id))
        return [...current, ...data.filter((message) => !ids.has(message.id))]
      })
      exhaustedHistory.current = data.length < pageSize
      setHasEarlier(!exhaustedHistory.current)
    } catch {
      setError('Could not load older recommendations.')
    } finally {
      setLoadingEarlier(false)
    }
  }

  return (
    <section className="min-w-0 flex-1 px-5 py-8 md:px-9 md:py-11">
      <div className="mx-auto max-w-5xl">
      <h1 className="font-display text-3xl font-semibold tracking-[-0.045em] sm:text-4xl">Friends Recommendations</h1>
      {loading && <p role="status" className="mt-6 text-sm text-white/60">Loading recommendations…</p>}
      {error && <p role="alert" className="mt-5 rounded-lg border border-red-300/20 px-3 py-2 text-sm text-red-300">{error} <button type="button" className="underline" onClick={() => setRetry((value) => value + 1)}>Retry</button></p>}
      {!loading && !error && !threads.size && (
        <div className="mt-6 rounded-2xl border border-white/10 bg-[#141216] px-5 py-10 text-center sm:py-14">
          <p className="font-display text-base font-semibold">No recommendations yet</p>
          <p className="mt-2 text-sm text-white/60">Rate a finished book to recommend it to a friend.</p>
        </div>
      )}
      {threads.size > 0 && (
        <div className="mt-6 grid overflow-hidden rounded-2xl border border-white/10 bg-[#100e12] md:grid-cols-[minmax(0,13.5rem)_minmax(0,1fr)]">
          <aside className="min-w-0 border-b border-white/10 bg-[#141216] md:border-r md:border-b-0">
            <h2 className="hidden px-4 pt-4 pb-2 text-xs font-semibold text-white/60 md:block">Conversations</h2>
            <ul aria-label="Recommendation conversations" className="flex gap-1.5 overflow-x-auto p-2 md:max-h-[36rem] md:flex-col md:overflow-x-hidden md:overflow-y-auto">
            {[...threads].map(([id, thread]) => (
              <li key={id} className="max-w-[14rem] shrink-0 md:max-w-none">
                <button type="button" aria-current={id === activeFriend ? 'true' : undefined}
                  onClick={() => { setReadError(false); setActiveFriend(id) }}
                  className={`flex w-full items-center gap-2 rounded-xl border px-2.5 py-2 text-left focus-visible:outline-[#c7ff36] ${id === activeFriend ? 'border-[#c7ff36]/20 bg-[#c7ff36]/5' : 'border-transparent hover:bg-white/5'}`}>
                  <FriendInitial name={thread.name} selected={id === activeFriend} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">@{thread.name}</span>
                    <span className="hidden truncate text-xs text-white/55 md:block">{thread.messages[0].title}</span>
                  </span>
                  {thread.unread > 0 && <span aria-label={`${thread.unread} unread`} className="grid min-w-5 shrink-0 place-items-center rounded-full bg-[#c7ff36] px-1 text-xs font-semibold text-black">{thread.unread}</span>}
                </button>
              </li>
            ))}
            </ul>
          </aside>
          <div className="min-w-0">
            {!activeThread ? <p className="p-5 text-sm text-white/65">Choose a friend to view your recommendations.</p> : (
              <>
                <header className="flex items-center gap-3 border-b border-white/10 bg-[#141216] px-4 py-3 sm:px-5">
                  <FriendInitial name={activeThread.name} selected />
                  <h2 className="min-w-0 truncate font-display text-sm font-semibold sm:text-base">@{activeThread.name}</h2>
                </header>
                {readError && <button type="button" onClick={() => setReadError(false)} className="mx-4 mt-3 text-xs text-red-300 underline">Retry marking recommendations as read</button>}
                <ol ref={chatHistory} aria-label={`Recommendations with @${activeThread.name}`} className="min-h-64 max-h-[min(59dvh,35rem)] space-y-3 overflow-y-auto px-3 py-4 sm:min-h-80 sm:px-5">
                  {chronological.map((message, index) => {
                    const date = messageDate.format(new Date(message.created_at))
                    const previous = chronological[index - 1]
                    const newDay = !previous || messageDate.format(new Date(previous.created_at)) !== date
                    return (
                      <li key={message.id}>
                        {newDay && <p className="mb-3 flex items-center gap-3 text-center text-[11px] font-medium text-white/55 before:h-px before:flex-1 before:bg-white/10 after:h-px after:flex-1 after:bg-white/10">{date}</p>}
                        <div className={`flex ${message.sender_id === userId ? 'justify-end' : 'justify-start'}`}>
                          <RecommendationCard message={message} own={message.sender_id === userId} onChooseBook={onChooseBook} />
                        </div>
                      </li>
                    )
                  })}
                </ol>
              </>
            )}
          </div>
        </div>
      )}
      {hasEarlier && <button type="button" disabled={loadingEarlier} onClick={() => void loadEarlier()} className={`mt-4 ${secondaryClass}`}>{loadingEarlier ? 'Loading…' : 'Load older recommendations'}</button>}
      </div>
    </section>
  )
}
