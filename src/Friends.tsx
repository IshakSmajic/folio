import { type FormEvent, useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'

type Profile = { user_id: string; username: string; library_public: boolean }
type Friendship = {
  user_low: string
  user_high: string
  requested_by: string
  accepted: boolean
  low: Profile
  high: Profile
}
export type SharedBook = { id: string; title: string; author: string; cover_photo: string | null; cover_url: string | null }

const profileFields = 'user_id, username, library_public'
const namePattern = /^[a-z0-9_]{3,24}$/
const inputClass = 'min-w-0 rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm outline-none focus:border-[#c7ff36]/60'
const primaryClass = 'rounded-xl bg-[#c7ff36] px-4 py-2 text-sm font-semibold text-black disabled:opacity-50'
const secondaryClass = 'rounded-xl border border-white/15 px-3 py-2 text-sm hover:bg-white/10 disabled:opacity-50'
const pageSize = 12

function SharedLibrary({ friend, onBack, onChooseBook }: { friend: Profile; onBack: () => void; onChooseBook: (book: SharedBook) => void }) {
  const [books, setBooks] = useState<SharedBook[]>([])
  const [pageOffset, setPageOffset] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!supabase) return
    const client = supabase
    const controller = new AbortController()
    async function loadPage() {
      try {
        const { data, error } = await client.rpc('read_friend_library', { friend_id: friend.user_id, page_offset: pageOffset })
          .abortSignal(controller.signal)
        if (controller.signal.aborted) return
        if (error?.code === '42501') {
          setBooks([])
          setHasMore(false)
          setError('This library is private or no longer shared with you.')
          return
        }
        if (error) throw error
        if (!Array.isArray(data)) throw new Error('Unexpected library response.')
        const page: SharedBook[] = data
        setBooks((current) => pageOffset === 0 ? page : [...current, ...page.filter((book) => !current.some((item) => item.id === book.id))])
        setHasMore(page.length === pageSize)
      } catch {
        if (controller.signal.aborted) return
        setBooks([])
        setHasMore(false)
        setError('Could not load this library. Go back and try again.')
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }
    void loadPage()
    return () => controller.abort()
  }, [friend.user_id, pageOffset])

  return (
    <section className="min-w-0 flex-1 px-5 py-8 md:px-9 md:py-11">
      <button type="button" onClick={onBack} className="mb-4 text-sm font-semibold text-[#c7ff36]">← Back to friends</button>
      <h1 className="font-display text-4xl font-medium tracking-tight">@{friend.username}’s library</h1>
      {error && <p role="alert" className="mt-6 text-sm text-red-300">{error}</p>}
      {loading && <p role="status" className="mt-6 text-sm text-white/60">Loading library…</p>}
      {!loading && !error && !books.length && <p className="mt-6 text-sm text-white/60">No books in this collection yet.</p>}
      {books.length > 0 && (
        <ul aria-label="Shared books" className="mt-6 grid grid-cols-2 gap-5 sm:grid-cols-3 xl:grid-cols-5">
          {books.map((book) => {
            const cover = book.cover_photo ?? book.cover_url
            return (
              <li key={book.id} className="min-w-0">
                <button type="button" aria-label={`Add ${book.title} to your library`} onClick={() => onChooseBook(book)}
                  className="group block w-full rounded text-left focus-visible:outline-[#c7ff36]">
                <div className="relative grid aspect-[2/3] place-items-center overflow-hidden rounded bg-gradient-to-br from-[#24132b] to-[#60416f] p-3 text-center">
                  <span aria-hidden="true" className="font-display text-sm font-semibold">{book.title}</span>
                  {cover && <img src={cover} alt="" loading="lazy" referrerPolicy="no-referrer" className="absolute inset-0 size-full object-cover" onError={(event) => { event.currentTarget.hidden = true }} />}
                </div>
                <p className="mt-2 break-words text-sm font-semibold group-hover:text-[#c7ff36]">{book.title}</p>
                <p className="text-xs text-white/55">{book.author}</p>
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {hasMore && <button type="button" disabled={loading} className={`mt-6 ${secondaryClass}`} onClick={() => {
        setLoading(true)
        setPageOffset((offset) => offset + pageSize)
      }}>Load more</button>}
    </section>
  )
}

export default function Friends({ userId, onRequestsChanged, onChooseBook }: {
  userId: string
  onRequestsChanged: () => void
  onChooseBook: (book: SharedBook) => void
}) {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [username, setUsername] = useState('')
  const [libraryPublic, setLibraryPublic] = useState(false)
  const [friendName, setFriendName] = useState('')
  const [connections, setConnections] = useState<Friendship[]>([])
  const [viewing, setViewing] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const loadConnections = useCallback(async (signal?: AbortSignal) => {
    if (!supabase) return
    const request = supabase.from('friendships')
      .select(`user_low, user_high, requested_by, accepted, low:friend_profiles!friendships_user_low_fkey(${profileFields}), high:friend_profiles!friendships_user_high_fkey(${profileFields})`)
    if (signal) request.abortSignal(signal)
    const { data, error } = await request.returns<Friendship[]>()
    if (error) throw error
    if (!signal?.aborted) setConnections(data)
  }, [])

  useEffect(() => {
    if (!supabase) return
    const controller = new AbortController()
    const client = supabase
    async function load() {
      try {
        const { data, error } = await client.from('friend_profiles').select(profileFields)
          .eq('user_id', userId).abortSignal(controller.signal).maybeSingle<Profile>()
        if (error) throw error
        if (data && !controller.signal.aborted) {
          setProfile(data)
          setUsername(data.username)
          setLibraryPublic(data.library_public)
        }
        await loadConnections(controller.signal)
        if (!controller.signal.aborted) setReady(true)
      } catch {
        if (!controller.signal.aborted) setError('Could not load friends and privacy settings.')
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }
    void load()
    return () => controller.abort()
  }, [loadConnections, userId])

  useEffect(() => {
    if (!ready || viewing) return
    const controller = new AbortController()
    const refresh = () => { void loadConnections(controller.signal).catch(() => {}) }
    window.addEventListener('focus', refresh)
    return () => {
      window.removeEventListener('focus', refresh)
      controller.abort()
    }
  }, [ready, viewing, loadConnections])

  async function perform(action: () => Promise<void>, message: string) {
    if (busy) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await action()
    } catch {
      setError(message)
    } finally {
      setBusy(false)
    }
  }

  function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const client = supabase
    const name = username.trim().toLowerCase()
    if (!client || !namePattern.test(name)) {
      setError('Use 3–24 letters, numbers, or underscores for your username.')
      return
    }
    void perform(async () => {
      const values = { username: name, library_public: libraryPublic }
      const request = profile
        ? client.from('friend_profiles').update(values).eq('user_id', userId)
        : client.from('friend_profiles').insert(values)
      const { data, error } = await request.select(profileFields).single<Profile>()
      if (error?.code === '23505') {
        setError('That username is already taken.')
        return
      }
      if (error) throw error
      setProfile(data)
      setUsername(data.username)
      setNotice('Profile and library privacy saved.')
    }, 'Could not save your profile.')
  }

  function sendRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const client = supabase
    const target = friendName.trim().toLowerCase()
    if (!client || !namePattern.test(target)) {
      setError('Enter the person’s Folio username.')
      return
    }
    void perform(async () => {
      const { error } = await client.rpc('request_friend', { target_username: target })
      if (error?.code === '22023') {
        setError('No other Folio user was found with that username.')
        return
      }
      if (error) throw error
      setFriendName('')
      await loadConnections()
      setNotice(`Connection with @${target} is shown below.`)
    }, 'Could not send a friend request.')
  }

  function updateConnection(connection: Friendship, accept: boolean) {
    const client = supabase
    if (!client) return
    void perform(async () => {
      const request = accept ? client.from('friendships').update({ accepted: true }) : client.from('friendships').delete()
      const { data, error } = await request.eq('user_low', connection.user_low).eq('user_high', connection.user_high)
        .select('user_low').maybeSingle()
      if (error) throw error
      onRequestsChanged()
      await loadConnections()
      setNotice(!data ? 'This connection is no longer pending.' : accept ? 'Friend request accepted.' : 'Connection removed.')
    }, 'Could not update this connection.')
  }

  if (viewing) return <SharedLibrary key={viewing.user_id} friend={viewing} onChooseBook={onChooseBook} onBack={() => {
    setViewing(null)
    void loadConnections().catch(() => setError('Could not refresh your friends.'))
  }} />

  return (
    <section className="min-w-0 flex-1 px-5 py-8 md:px-9 md:py-11">
      <h1 className="font-display text-4xl font-medium tracking-tight">Friends</h1>
      {loading && <p role="status" className="mt-6 text-sm text-white/60">Loading friends…</p>}
      {error && <p role="alert" className="mt-4 text-sm text-red-300">{error}</p>}
      {notice && <p role="status" className="mt-4 text-sm text-[#c7ff36]">{notice}</p>}
      {ready && (
        <div className="mt-6 max-w-3xl space-y-8">
          <form onSubmit={saveProfile} className="space-y-4 rounded-2xl border border-white/10 bg-white/[0.035] p-5">
            <h2 className="font-display text-xl font-semibold">Profile and library privacy</h2>
            <label className="block text-sm">Folio username
              <input required maxLength={24} value={username} onChange={(event) => setUsername(event.target.value)} autoCapitalize="none"
                className={`mt-2 block w-full max-w-xs ${inputClass}`} placeholder="Choose a username" />
            </label>
            <fieldset>
              <legend className="mb-2 text-sm font-semibold">Library visibility</legend>
              <div className="flex flex-wrap gap-4 text-sm">
                <label><input type="radio" name="visibility" checked={!libraryPublic} onChange={() => setLibraryPublic(false)} className="mr-2 accent-[#c7ff36]" />Private</label>
                <label><input type="radio" name="visibility" checked={libraryPublic} onChange={() => setLibraryPublic(true)} className="mr-2 accent-[#c7ff36]" />Public</label>
              </div>
              <p className="mt-2 text-xs text-white/60">Only you can see a private library. Accepted friends can see your collection when it’s public.</p>
            </fieldset>
            <button type="submit" disabled={busy} className={primaryClass}>Save profile</button>
          </form>

          {profile && (
            <>
              <form onSubmit={sendRequest}>
                <label className="block text-sm font-semibold">Add a friend
                  <span className="sr-only"> by Folio username</span>
                  <input required maxLength={24} value={friendName} onChange={(event) => setFriendName(event.target.value)} autoCapitalize="none"
                    className={`mt-2 block w-full max-w-xs ${inputClass}`} placeholder="Their Folio username" />
                </label>
                <button type="submit" disabled={busy} className={`mt-3 ${primaryClass}`}>Send friend request</button>
              </form>
              <section aria-labelledby="connections-heading">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h2 id="connections-heading" className="font-display text-xl font-semibold">Friends and requests</h2>
                  <button type="button" disabled={busy} className="text-xs text-[#c7ff36]" onClick={() => void perform(loadConnections, 'Could not refresh your friends.')}>Refresh</button>
                </div>
                {!connections.length && <p className="text-sm text-white/60">No friends or requests yet.</p>}
                <ul className="space-y-2">
                  {connections.map((connection) => {
                    const friend = connection.user_low === userId ? connection.high : connection.low
                    const incoming = connection.requested_by !== userId
                    return (
                      <li key={friend.user_id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 p-3">
                        <div className="min-w-0">
                          {connection.accepted ? (
                            <button type="button" onClick={() => setViewing(friend)}
                              className="break-words text-left text-sm font-semibold text-[#c7ff36] underline decoration-[#c7ff36]/45 underline-offset-4 hover:decoration-current focus-visible:outline-[#c7ff36]">
                              @{friend.username}
                            </button>
                          ) : <p className="break-words text-sm font-semibold">@{friend.username}</p>}
                          <p className="mt-1 text-xs text-white/60">{connection.accepted ? (friend.library_public ? 'Public library' : 'Private library') : (incoming ? 'Incoming request' : 'Request sent')}</p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {!connection.accepted && incoming && <button type="button" disabled={busy} onClick={() => updateConnection(connection, true)} className={primaryClass}>Accept</button>}
                          <button type="button" disabled={busy} onClick={() => updateConnection(connection, false)} className={secondaryClass}>
                            {connection.accepted ? 'Remove friend' : incoming ? 'Decline' : 'Cancel request'}
                          </button>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </section>
            </>
          )}
        </div>
      )}
    </section>
  )
}
