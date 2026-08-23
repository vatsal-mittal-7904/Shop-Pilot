'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { authenticate } from '@/backend/actions/auth'

export default function Home() {
  const router = useRouter()
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setPending(true)
    try {
      const result = await authenticate({ email, password, name: mode === 'sign-up' ? name : undefined, mode })
      router.push(result.role === 'merchant' ? '/merchant/portal' : '/agent')
      router.refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to continue')
    } finally {
      setPending(false)
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 p-4 flex items-center justify-center">
      <section className="w-full max-w-md overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl">
        <div className="bg-indigo-700 p-8 text-white">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-indigo-200">MerchantOS AI</p>
          <h1 className="mt-2 text-3xl font-bold">Agentic commerce, safely governed.</h1>
          <p className="mt-3 text-sm text-indigo-100">Customers shop with an AI agent. The TechNest merchant controls catalog and revenue actions.</p>
        </div>
        <form className="space-y-4 p-8" onSubmit={submit}>
          {mode === 'sign-up' && <label className="block text-sm font-medium text-slate-700">Name<input required value={name} onChange={(event) => setName(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3" /></label>}
          <label className="block text-sm font-medium text-slate-700">Email<input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3" placeholder="you@example.com" /></label>
          <label className="block text-sm font-medium text-slate-700">Password<input required type="password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3" placeholder="At least 8 characters" /></label>
          {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
          <button disabled={pending} className="w-full rounded-xl bg-indigo-600 py-3 font-semibold text-white disabled:opacity-60">{pending ? 'Please wait…' : mode === 'sign-in' ? 'Sign in' : 'Create customer account'}</button>
          <button type="button" onClick={() => setMode((current) => current === 'sign-in' ? 'sign-up' : 'sign-in')} className="w-full text-sm font-medium text-indigo-700">{mode === 'sign-in' ? 'New customer? Create an account' : 'Already have an account? Sign in'}</button>
          <p className="text-center text-xs text-slate-500">The seeded TechNest merchant uses the environment-configured admin credentials.</p>
        </form>
      </section>
    </main>
  )
}
