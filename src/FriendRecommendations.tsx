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
const timestamp = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })

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
  const unreadKey = activeThread?.messages.filter((message) => message.recipient_id === userId && message.read_at === null)
    .map((message) => message.id).join(',') ?? ''

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
      <h1 className="font-display text-4xl font-medium tracking-tight">Friends Recommendations</h1>
      {loading && <p role="status" className="mt-5 text-sm text-white/60">Loading recommendations…</p>}
      {error && <p role="alert" className="mt-5 text-sm text-red-300">{error} <button type="button" className="underline" onClick={() => setRetry((value) => value + 1)}>Retry</button></p>}
      {!loading && !error && !threads.size && <p className="mt-5 text-sm text-white/65">No recommendations yet. Rate a finished book to recommend it to a friend.</p>}
      {threads.size > 0 && (
        <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(9rem,13rem)_minmax(0,1fr)]">
          <ul aria-label="Recommendation conversations" className="flex flex-wrap gap-2 lg:flex-col">
            {[...threads].map(([id, thread]) => (
              <li key={id}>
                <button type="button" aria-current={id === activeFriend ? 'true' : undefined}
                  onClick={() => { setReadError(false); setActiveFriend(id) }}
                  className={`flex w-full items-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-left text-sm ${id === activeFriend ? 'bg-[#372443]' : 'hover:bg-white/10'}`}>
                  <span className="break-all">@{thread.name}</span>
                  {thread.unread > 0 && <span aria-label={`${thread.unread} unread`} className="ml-auto rounded-full bg-[#c7ff36] px-1.5 text-xs font-semibold text-black">{thread.unread}</span>}
                </button>
              </li>
            ))}
          </ul>
          <div className="min-w-0 rounded-2xl border border-white/10 bg-white/[0.035] p-4 sm:p-5">
            {!activeThread ? <p className="text-sm text-white/65">Choose a friend to view your recommendations.</p> : (
              <>
                <h2 className="mb-4 font-display text-xl font-semibold">@{activeThread.name}</h2>
                {readError && <button type="button" onClick={() => setReadError(false)} className="mb-2 text-xs text-red-300 underline">Retry marking recommendations as read</button>}
                <ol aria-label={`Recommendations with @${activeThread.name}`} className="max-h-[62vh] space-y-3 overflow-y-auto">
                  {[...activeThread.messages].reverse().map((message) => {
                    const own = message.sender_id === userId
                    const cover = message.cover_photo ?? message.cover_url
                    return (
                      <li key={message.id} className={`max-w-sm rounded-2xl border border-white/10 p-3 ${own ? 'ml-auto bg-[#302039]' : 'mr-auto bg-[#19151d]'}`}>
                        <p className="break-words text-sm font-semibold">@{message.sender_username} recommends this book!</p>
                        <p className="mt-1 text-sm font-medium text-[#c7ff36]">{message.rating}/10</p>
                        <button type="button" onClick={() => onChooseBook(message)} className="mt-3 flex w-full items-center gap-3 rounded-lg text-left hover:bg-white/10">
                          <span className="grid h-[84px] w-14 shrink-0 place-items-center overflow-hidden rounded bg-[#54345e]">
                            {cover ? <img src={cover} alt="" loading="lazy" referrerPolicy="no-referrer" className="size-full object-cover" onError={(event) => { event.currentTarget.hidden = true }} /> : null}
                          </span>
                          <span className="min-w-0"><span className="block break-words text-sm font-semibold">{message.title}</span><span className="block text-xs text-white/60">{message.author}</span></span>
                        </button>
                        <time dateTime={message.created_at} className="mt-2 block text-xs text-white/55">{timestamp.format(new Date(message.created_at))}</time>
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
    </section>
  )
}
