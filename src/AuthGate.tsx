import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'

export default function AuthGate({ children, guest }: { children: (session: Session) => ReactNode; guest: (exit: () => void) => ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(Boolean(supabase))
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [guestTab, setGuestTab] = useState(false)
  const [guestActive, setGuestActive] = useState(false)

  useEffect(() => {
    if (!supabase) return
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      setLoading(false)
    })
    return () => subscription.unsubscribe()
  }, [])

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || submitting) return
    const data = new FormData(event.currentTarget)
    setSubmitting(true)
    setError('')
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: String(data.get('email')).trim(),
        password: String(data.get('password')),
      })
      if (error) setError(error.message)
    } catch {
      setError('Could not reach Supabase. Try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (session) return children(session)
  if (guestActive) return guest(() => { setGuestActive(false); setGuestTab(false) })

  return (
    <main className="grid min-h-screen place-items-center bg-[#0b0b0d] px-5 text-[#f4f2f5]">
      <section className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#171219] p-7">
        <p className="mb-2 font-display text-xl font-semibold text-[#c7ff36]">folio.</p>
        <h1 className="mb-5 font-display text-3xl font-semibold">Your library</h1>
        <div role="group" aria-label="Choose how to access Folio" className="mb-5 grid grid-cols-2 gap-1 rounded-xl bg-black/30 p-1">
          <button type="button" aria-pressed={!guestTab} onClick={() => setGuestTab(false)} className={`rounded-lg px-2 py-2 text-sm ${!guestTab ? 'bg-white/10 font-semibold' : 'text-white/65'}`}>Sign in</button>
          <button type="button" aria-pressed={guestTab} onClick={() => setGuestTab(true)} className={`rounded-lg px-2 py-2 text-sm ${guestTab ? 'bg-white/10 font-semibold' : 'text-white/65'}`}>Guest</button>
        </div>
        {guestTab ? (
          <div className="grid gap-4">
            <p className="text-sm leading-6 text-white/70">View a sample library and its ratings without an account.</p>
            <button type="button" onClick={() => setGuestActive(true)} className="rounded-xl bg-[#c7ff36] px-4 py-3 text-sm font-semibold text-black">Log in as guest</button>
          </div>
        ) : loading ? <p role="status">Loading your session...</p> : !supabase ? (
          <p role="alert">Folio needs its Supabase URL and publishable key before you can sign in.</p>
        ) : (
          <form className="grid gap-4" onSubmit={signIn}>
            <label className="grid gap-2 text-sm">Email
              <input required name="email" type="email" autoComplete="username" className="rounded-xl border border-white/10 bg-black/25 px-4 py-3" />
            </label>
            <label className="grid gap-2 text-sm">Password
              <input required name="password" type="password" autoComplete="current-password" className="rounded-xl border border-white/10 bg-black/25 px-4 py-3" />
            </label>
            {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
            <button disabled={submitting} className="rounded-xl bg-[#c7ff36] px-4 py-3 font-semibold text-black disabled:opacity-60">
              {submitting ? 'Signing in...' : 'Sign in'}
            </button>
          </form>
        )}
      </section>
    </main>
  )
}
