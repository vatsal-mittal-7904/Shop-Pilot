'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { authenticate } from '@/backend/actions/auth'
import { ThemeToggle } from '@/frontend/components/ThemeToggle'

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
    <main className="min-h-screen flex w-full font-sans bg-white dark:bg-[#0B1221]">
      
      {/* ================= LEFT PANE: IMAGE & BRANDING ================= */}
      <div className="hidden lg:flex flex-col flex-1 relative bg-slate-900 overflow-hidden">
        
        {/* Full Cover Image (Generated AI Agentic Commerce Hero) */}
        <div 
          className="absolute inset-0 bg-cover bg-center bg-no-repeat brightness-125 contrast-105"
          style={{ backgroundImage: `url('/ai_commerce_hero.jpg')` }}
        ></div>
        
        {/* Lighter overlays to keep the image bright while ensuring bottom text is readable */}
        <div className="absolute inset-0 bg-gradient-to-tr from-[#0B1221]/90 via-[#0B1221]/30 to-transparent"></div>
        
        {/* Logo positioned at Top Left */}
        <div className="absolute top-10 left-12 z-10 w-[180px] h-[40px] relative">
            <Image 
              src="/logo-dark.png" 
              alt="Razorpay" 
              fill 
              className="object-contain object-left" 
              priority 
            />
        </div>

        {/* Hero Text at Bottom Left matching the screenshot's vibe */}
        <div className="absolute bottom-16 left-12 right-12 z-10 text-white">
          <h2 className="text-4xl font-semibold leading-tight mb-6 max-w-2xl drop-shadow-sm">
            Join the future of agentic commerce with Razorpay MerchantOS.
          </h2>
          <div className="flex gap-6 text-sm font-medium text-gray-200">
            <span className="flex items-center gap-2">
              <svg className="w-5 h-5 text-white/70" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
              Autonomous AI Agents
            </span>
            <span className="flex items-center gap-2">
              <svg className="w-5 h-5 text-white/70" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
              Smart Analytics
            </span>
            <span className="flex items-center gap-2">
              <svg className="w-5 h-5 text-white/70" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
              Secure Integrations
            </span>
          </div>
        </div>
      </div>

      {/* ================= RIGHT PANE: FORM PANEL ================= */}
      <div className="w-full lg:w-[500px] xl:w-[600px] relative flex flex-col bg-white dark:bg-[#0B1221] shadow-[-20px_0_40px_rgba(0,0,0,0.05)] z-20">
        
        {/* Theme Toggle Button */}
        <div className="absolute top-6 right-6 z-30">
          <ThemeToggle />
        </div>

        {/* Diagonal Corner Ribbon matching the "0% Platform Fees" */}
        <div className="absolute top-0 right-0 overflow-hidden w-40 h-40 pointer-events-none hidden sm:block">
           <div className="absolute top-10 -right-12 w-56 bg-indigo-50 dark:bg-indigo-900/40 text-[#2B64F5] dark:text-blue-300 text-xs font-bold text-center py-1.5 transform rotate-45 border-y border-indigo-100 dark:border-indigo-800 shadow-sm">
             AGENTIC BETA
           </div>
        </div>

        <div className="flex-1 overflow-y-auto p-8 sm:p-12 xl:px-16 xl:py-12 flex flex-col justify-center">
          
          {/* Mobile Logo Fallback (Shown only on small screens where the left pane is hidden) */}
          <div className="lg:hidden w-[150px] h-[36px] relative mb-10">
            <Image src="/logo-light.svg" alt="Razorpay" fill className="object-contain object-left block dark:hidden" priority />
            <Image src="/logo-dark.png" alt="Razorpay" fill className="object-contain object-left hidden dark:block" priority />
          </div>

          {/* Icon Box */}
          <div className="w-12 h-12 relative mb-6 shadow-sm rounded-xl overflow-hidden">
            <Image src="/icon-logo.png" alt="Razorpay Icon" fill className="object-cover" priority />
          </div>

          <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-2 tracking-wide">
            Welcome to <span className="text-slate-900 dark:text-white font-bold">Razorpay MerchantOS</span>
          </p>
          
          <h1 className="text-3xl font-semibold text-[#0B1221] dark:text-white mb-8 leading-[1.2] tracking-tight">
            Get started with your <br/>email {mode === 'sign-in' ? 'to log in' : 'to create a customer account'}
          </h1>

          <form className="space-y-4" onSubmit={submit}>
            {mode === 'sign-up' && (
              <input aria-label="Full name" required value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-[#161D2B] text-slate-900 dark:text-white px-4 py-3.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#2B64F5] transition-all" placeholder="Full Name" />
            )}
            
            <input aria-label="Email" required type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-[#161D2B] text-slate-900 dark:text-white px-4 py-3.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#2B64F5] transition-all" placeholder="Enter your email address" />
            
            <input aria-label="Password" required type="password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} className="w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-[#161D2B] text-slate-900 dark:text-white px-4 py-3.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#2B64F5] transition-all" placeholder="Enter password" />
            
            {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400 font-medium">{error}</p>}
            
            <button disabled={pending} className="w-full rounded-md bg-[#2B64F5] hover:bg-[#1E52D8] py-3.5 mt-2 font-medium text-white text-sm transition-all disabled:opacity-60 disabled:cursor-not-allowed shadow-sm">
              {pending ? 'Please wait…' : 'Continue'}
            </button>
          </form>

          {/* Divider */}
          <div className="flex items-center my-6">
            <div className="flex-1 h-px bg-gray-200 dark:bg-gray-800"></div>
            <span className="px-3 text-xs text-slate-400 dark:text-slate-500 font-medium uppercase">or</span>
            <div className="flex-1 h-px bg-gray-200 dark:bg-gray-800"></div>
          </div>

          <p className="mt-6 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
            Demo environment: sign in with an existing account or create a customer account. Payments use Razorpay test mode.
          </p>

          {/* Mode Switcher / Partner Box */}
          <div className="mt-auto pt-8">
            <div className="bg-slate-50 dark:bg-[#161D2B] rounded-lg p-5 border border-slate-100 dark:border-slate-800">
              <p className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                {mode === 'sign-in' ? "Don't have a customer account yet?" : "Already have an account?"}
              </p>
              <button 
                type="button" 
                onClick={() => setMode((current) => current === 'sign-in' ? 'sign-up' : 'sign-in')} 
                className="text-sm font-semibold text-[#2B64F5] hover:text-[#1E52D8] text-left inline-flex items-center gap-1 transition-colors"
              >
                {mode === 'sign-in' ? 'Create customer account' : 'Log in'} 
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>
              </button>
            </div>
          </div>

        </div>
      </div>
    </main>
  )
}
