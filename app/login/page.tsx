'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const supabase = createClient()
    // Username login: a bare name (no @) maps to its account email under the hood
    const emailToUse = email.includes('@')
      ? email.trim()
      : `${email.trim().toLowerCase()}@gulflife.crm`
    const { error } = await supabase.auth.signInWithPassword({ email: emailToUse, password })

    if (error) {
      // Be honest about WHY it failed — a rate limit or network problem
      // is not the same as a wrong password.
      const msg = error.message.toLowerCase()
      if (msg.includes('invalid login credentials')) setError('Wrong username or password')
      else if (msg.includes('rate limit') || msg.includes('security purposes')) setError('Too many attempts — wait a minute, then try again')
      else if (msg.includes('banned')) setError('This account has been deactivated')
      else setError(`Sign-in problem: ${error.message}`)
      setLoading(false)
      return
    }

    router.push('/crm')
    router.refresh()
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: '#f7f5f0' }}>
      <div className="w-full max-w-[400px]">
        {/* Logo — the real Gulf Life lockup */}
        <div className="flex flex-col items-center mb-8">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-dark.png" alt="Gulf Life Concierge" className="w-[168px] h-auto mb-3" />
          <p className="text-[13.5px] text-ink-2 mt-1 m-0">Sign in to your workspace</p>
        </div>

        {/* Card */}
        <div className="bg-card border border-line rounded-card shadow-card px-7 py-7">
          {/* action guard: if JS hasn't loaded yet, a native submit does nothing
              instead of reloading the page and clearing the form */}
          <form action="javascript:void(0)" onSubmit={handleLogin} className="flex flex-col gap-4">
            <label className="block">
              <span className="block text-[13px] font-medium text-ink-2 mb-1.5">Username or email</span>
              <input
                type="text"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoComplete="username"
                placeholder="Ryder"
                className="w-full bg-card border border-line-strong rounded-btn px-3.5 py-2.5 text-[14px] text-ink"
              />
            </label>
            <label className="block">
              <span className="block text-[13px] font-medium text-ink-2 mb-1.5">Password</span>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                placeholder="••••••••"
                className="w-full bg-card border border-line-strong rounded-btn px-3.5 py-2.5 text-[14px] text-ink"
              />
            </label>

            {error && (
              <p className="text-[13px] font-medium text-bad bg-bad-soft rounded-lg px-3.5 py-2.5 m-0">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-navy hover:bg-navy-dark text-white font-semibold text-[14.5px] rounded-btn py-2.5 transition-colors disabled:opacity-50 mt-1"
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>

        <p className="text-center text-[12px] text-ink-3 mt-6">Gulf Life Concierge · 30A, Florida</p>
      </div>
    </div>
  )
}
