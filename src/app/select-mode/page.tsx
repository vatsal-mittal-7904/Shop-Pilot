import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getCurrentSession } from '@/backend/auth/session'
import { ThemeToggle } from '@/frontend/components/ThemeToggle'
import { signOut } from '@/backend/actions/auth'

export default async function SelectModePage() {
  const session = await getCurrentSession()
  if (!session?.user) {
    redirect('/')
  }

  if (session.user.role === 'MERCHANT') {
    redirect('/merchant/portal')
  }

  const customerName = session.user.name || session.user.email.split('@')[0]
  const profile = (session.user.customer?.deliveryProfile as Record<string, unknown> | null) ?? {}
  const isAutonomousEnabled = profile.autonomousCheckoutEnabled === true
  const spendCeilingPaise = typeof profile.autonomousSpendCeiling === 'number' ? profile.autonomousSpendCeiling : (session.user.customer?.dailySpendLimit ?? 5000000)

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-[#070b14] text-slate-900 dark:text-slate-100 selection:bg-indigo-100 transition-colors">
      {/* Navigation Header */}
      <header className="border-b border-slate-200/80 dark:border-slate-800/80 bg-white/80 dark:bg-[#0c1220]/80 backdrop-blur-md sticky top-0 z-30 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center text-white font-bold shadow-md shadow-blue-500/20">
              R
            </div>
            <div>
              <span className="font-bold tracking-tight text-base sm:text-lg">MerchantOS</span>
              <span className="ml-2 text-[11px] font-semibold tracking-wider uppercase px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800/60">
                Track 01 • Agentic Commerce
              </span>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <ThemeToggle />
            <div className="hidden sm:flex flex-col text-right">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Signed in as</span>
              <span className="text-xs font-semibold">{session.user.email}</span>
            </div>
            <form action={signOut}>
              <button
                type="submit"
                className="text-xs font-medium px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors text-slate-600 dark:text-slate-300"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-6xl mx-auto w-full px-6 py-12 flex flex-col justify-center">
        <div className="text-center max-w-2xl mx-auto mb-12 animate-fade-in">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-50 dark:bg-indigo-950/50 border border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 text-xs font-semibold mb-4">
            <span>👋</span>
            <span>Welcome back, {customerName}</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-900 dark:text-white mb-3">
            Choose Your Commerce Experience
          </h1>
          <p className="text-sm sm:text-base text-slate-600 dark:text-slate-400 leading-relaxed">
            Select how you would like to interact with the merchant. You can switch between autonomous delegation and conversational advisory at any time.
          </p>
        </div>

        {/* 2 Big Actionable Mode Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-5xl mx-auto w-full">
          
          {/* Card 1: A2A (Agent-to-Agent Autonomous Commerce) */}
          <div className="group relative rounded-3xl p-8 bg-white dark:bg-[#0f172a] border-2 border-amber-500/30 hover:border-amber-500 transition-all duration-300 shadow-xl hover:shadow-2xl hover:shadow-amber-500/10 flex flex-col justify-between overflow-hidden">
            <div className="absolute top-0 right-0 w-36 h-36 bg-gradient-to-br from-amber-500/10 to-orange-500/5 rounded-bl-full pointer-events-none transition-transform group-hover:scale-110"></div>
            
            <div>
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-2xl bg-amber-500/15 border border-amber-500/30 text-amber-600 dark:text-amber-400 flex items-center justify-center text-2xl font-black shadow-inner">
                    ⚡
                  </div>
                  <div>
                    <span className="text-[11px] font-extrabold uppercase tracking-widest text-amber-600 dark:text-amber-400">
                      Autonomous Machine Agent
                    </span>
                    <h2 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
                      A2A (Agent-to-Agent)
                    </h2>
                  </div>
                </div>

                <span className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full border ${
                  isAutonomousEnabled 
                    ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 border-emerald-300 dark:border-emerald-800' 
                    : 'bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 border-amber-300 dark:border-amber-800'
                }`}>
                  {isAutonomousEnabled ? 'Pre-Auth: Active' : 'Setup Required'}
                </span>
              </div>

              <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed mb-6">
                Delegate purchasing to an autonomous buyer bot. The agent queries merchant catalog APIs, enforces hard spending ceilings, binds tamper-proof HMAC offers, and executes Razorpay checkouts autonomously.
              </p>

              <div className="space-y-3 mb-8">
                <div className="flex items-start gap-2.5 text-xs text-slate-700 dark:text-slate-300">
                  <span className="text-amber-500 font-bold">✔</span>
                  <span><strong>Zero-click checkout:</strong> Machine-to-machine catalog discovery and payment link generation</span>
                </div>
                <div className="flex items-start gap-2.5 text-xs text-slate-700 dark:text-slate-300">
                  <span className="text-amber-500 font-bold">✔</span>
                  <span><strong>Mathematical money safety:</strong> Hard daily limit (≤ ₹{(spendCeilingPaise / 100).toLocaleString('en-IN')}) & per-order cap</span>
                </div>
                <div className="flex items-start gap-2.5 text-xs text-slate-700 dark:text-slate-300">
                  <span className="text-amber-500 font-bold">✔</span>
                  <span><strong>Cryptographic tamper defense:</strong> Server-sealed HMAC-SHA256 basket binding rejects injection attacks</span>
                </div>
                <div className="flex items-start gap-2.5 text-xs text-slate-700 dark:text-slate-300">
                  <span className="text-amber-500 font-bold">✔</span>
                  <span><strong>Non-repudiation:</strong> Every autonomous step committed to Merkle audit chain</span>
                </div>
              </div>
            </div>

            <Link
              href="/agent/a2a"
              className="w-full flex items-center justify-center gap-2 py-4 px-6 rounded-2xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white font-bold text-sm shadow-lg shadow-amber-500/25 transition-all group-hover:shadow-amber-500/40"
            >
              <span>Launch A2A Autonomous Agent</span>
              <span className="transition-transform group-hover:translate-x-1">➔</span>
            </Link>
          </div>

          {/* Card 2: A2Human (AI Commerce Copilot & Advisory) - PRESERVED EXACTLY */}
          <div className="group relative rounded-3xl p-8 bg-white dark:bg-[#0f172a] border-2 border-blue-500/30 hover:border-blue-500 transition-all duration-300 shadow-xl hover:shadow-2xl hover:shadow-blue-500/10 flex flex-col justify-between overflow-hidden">
            <div className="absolute top-0 right-0 w-36 h-36 bg-gradient-to-br from-blue-500/10 to-indigo-500/5 rounded-bl-full pointer-events-none transition-transform group-hover:scale-110"></div>

            <div>
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-2xl bg-blue-500/15 border border-blue-500/30 text-blue-600 dark:text-blue-400 flex items-center justify-center text-2xl font-black shadow-inner">
                    💬
                  </div>
                  <div>
                    <span className="text-[11px] font-extrabold uppercase tracking-widest text-blue-600 dark:text-blue-400">
                      Conversational Advisor
                    </span>
                    <h2 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
                      A2Human (Copilot)
                    </h2>
                  </div>
                </div>

                <span className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full border bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 border-blue-300 dark:border-blue-800">
                  Standard Copilot
                </span>
              </div>

              <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed mb-6">
                Chat directly with TechNest’s consultative AI shopping advisor. Explore specs, compare options within your budget, claim personalized bundle discounts, and manually review offers before paying.
              </p>

              <div className="space-y-3 mb-8">
                <div className="flex items-start gap-2.5 text-xs text-slate-700 dark:text-slate-300">
                  <span className="text-blue-500 font-bold">✔</span>
                  <span><strong>Natural language discovery:</strong> Find matching products based on your conversational requirements</span>
                </div>
                <div className="flex items-start gap-2.5 text-xs text-slate-700 dark:text-slate-300">
                  <span className="text-blue-500 font-bold">✔</span>
                  <span><strong>Interactive catalog cards:</strong> Inspect real-time stock, pricing, and warranty details</span>
                </div>
                <div className="flex items-start gap-2.5 text-xs text-slate-700 dark:text-slate-300">
                  <span className="text-blue-500 font-bold">✔</span>
                  <span><strong>Principled negotiation:</strong> Claim authorized clearance or bundle discounts (never hallucinates)</span>
                </div>
                <div className="flex items-start gap-2.5 text-xs text-slate-700 dark:text-slate-300">
                  <span className="text-blue-500 font-bold">✔</span>
                  <span><strong>Human-in-the-loop:</strong> Explicit review and 1-click Razorpay payment modal</span>
                </div>
              </div>
            </div>

            <Link
              href="/agent"
              className="w-full flex items-center justify-center gap-2 py-4 px-6 rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-bold text-sm shadow-lg shadow-blue-500/25 transition-all group-hover:shadow-blue-500/40"
            >
              <span>Enter A2Human Shopping Chat</span>
              <span className="transition-transform group-hover:translate-x-1">➔</span>
            </Link>
          </div>

        </div>

        {/* Informative Footer Banner */}
        <div className="mt-12 text-center text-xs text-slate-500 dark:text-slate-400">
          <span>Both experiences are secured by Razorpay MerchantOS and backed by real-time cryptographic audit logging.</span>
        </div>
      </main>
    </div>
  )
}
