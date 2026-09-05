'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { ThemeToggle } from '@/frontend/components/ThemeToggle'
import { useAgentSession, type CustomerAutonomousSettings } from '../_components/AgentSessionProvider'
import { AutonomousAgentSettingsModal } from '../_components/AutonomousAgentSettingsModal'
import { runAutonomousBuyerAction, type AutonomousRunResult } from '@/backend/actions/autonomousBuyer'
import { CheckoutButton } from '../_components/CheckoutButton'

const DIRECTIVE_PRESETS = [
  { label: '⌨️ Mechanical Keyboard', directive: 'Procure high-grade mechanical keyboard with RGB under ₹10,000 INR', budget: 10000 },
  { label: '🎧 Studio Headphones', directive: 'Procure high-fidelity noise cancelling wireless headphones under ₹15,000 INR', budget: 15000 },
  { label: '🖱️ Ergonomic Mouse', directive: 'Procure precision ergonomic gaming mouse under ₹5,000 INR', budget: 5000 },
  { label: '⌚ Smartwatch', directive: 'Procure waterproof smartwatch with heart rate monitoring under ₹8,000 INR', budget: 8000 },
]

export default function A2AAutonomousAgentPage() {
  const { autonomousSettings: initialSettings } = useAgentSession()
  const [settings, setSettings] = useState<CustomerAutonomousSettings>(initialSettings)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [directive, setDirective] = useState(DIRECTIVE_PRESETS[0].directive)
  const [runResult, setRunResult] = useState<AutonomousRunResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const handleLaunch = () => {
    setError(null)
    setRunResult(null)

    if (!settings.enabled) {
      setError('Autonomous mode is currently disabled. Please click "Policy Settings" above to enable Autonomous Pre-Authorization.')
      return
    }

    startTransition(async () => {
      try {
        const result = await runAutonomousBuyerAction({
          directive,
        })
        setRunResult(result)
        if (!result.success && result.error) {
          setError(result.error)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Autonomous execution failed.')
      }
    })
  }

  const spendCeilingRupees = settings.autonomousSpendCeilingPaise != null
    ? settings.autonomousSpendCeilingPaise / 100
    : settings.dailySpendLimitPaise / 100

  const perOrderLimitRupees = settings.maxOrderSpendLimitPaise != null
    ? settings.maxOrderSpendLimitPaise / 100
    : spendCeilingRupees

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-[#070b14] text-slate-900 dark:text-slate-100 selection:bg-amber-100 transition-colors">
      
      {/* Top Navigation Bar */}
      <header className="border-b border-slate-200/80 dark:border-slate-800/80 bg-white/80 dark:bg-[#0c1220]/80 backdrop-blur-md sticky top-0 z-30 px-6 py-3.5">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/select-mode" className="flex items-center gap-2 group">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-amber-500 to-orange-500 flex items-center justify-center text-white font-bold shadow-md shadow-amber-500/20">
                ⚡
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-bold tracking-tight text-base">A2A Autonomous Agent</span>
                  <span className="text-[10px] font-extrabold uppercase tracking-widest px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                    Active
                  </span>
                </div>
              </div>
            </Link>
          </div>

          <div className="flex items-center gap-3">
            {/* Mode Switcher */}
            <Link
              href="/agent"
              className="flex items-center gap-2 text-xs font-semibold px-3.5 py-1.5 rounded-xl border border-blue-200 dark:border-blue-900/60 bg-blue-50/70 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/60 transition-colors shadow-sm"
              title="Switch to conversational shopping copilot"
            >
              <span>💬</span>
              <span className="hidden sm:inline">Switch to A2Human Copilot</span>
              <span className="sm:hidden">A2Human</span>
            </Link>

            {/* Policy Settings Modal Trigger */}
            <button
              onClick={() => setIsModalOpen(true)}
              className={`flex items-center gap-2 text-xs font-semibold px-3.5 py-1.5 rounded-xl border transition-colors shadow-sm ${
                settings.enabled
                  ? 'border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300'
                  : 'border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 animate-pulse'
              }`}
            >
              <span>🛡️</span>
              <span className="hidden md:inline">Policy Settings:</span>
              <span>{settings.enabled ? `ON (≤ ₹${spendCeilingRupees.toLocaleString('en-IN')})` : 'SETUP REQUIRED'}</span>
            </button>

            <ThemeToggle />
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-6xl mx-auto w-full px-4 sm:px-6 py-8 space-y-8">
        
        {/* Banner & Explanation */}
        <div className="rounded-3xl bg-gradient-to-r from-amber-500/10 via-orange-500/5 to-transparent border border-amber-500/20 p-6 sm:p-8 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-300 text-xs font-bold mb-3 border border-amber-500/30">
              <span>⚡ Machine-to-Machine Agentic Commerce (Track 01)</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white mb-2">
              Autonomous Procurement Buyer Agent
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
              Your autonomous buyer agent discovers catalog SKUs, evaluates specifications, signs HMAC-SHA256 basket bindings, and creates verified Razorpay order contracts under mathematically enforced spending limits.
            </p>
          </div>

          {/* Policy Card Metric Summary */}
          <div className="w-full md:w-auto flex-shrink-0 bg-white dark:bg-[#0f172a] rounded-2xl p-4 border border-slate-200 dark:border-slate-800 shadow-sm space-y-2 text-xs">
            <div className="flex justify-between gap-6 text-slate-500 dark:text-slate-400">
              <span>Autonomous Status:</span>
              <span className={`font-bold ${settings.enabled ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
                {settings.enabled ? 'Pre-Authorized' : 'Disabled'}
              </span>
            </div>
            <div className="flex justify-between gap-6 text-slate-500 dark:text-slate-400">
              <span>Spend Ceiling:</span>
              <span className="font-bold text-slate-900 dark:text-slate-100">₹{spendCeilingRupees.toLocaleString('en-IN')}</span>
            </div>
            <div className="flex justify-between gap-6 text-slate-500 dark:text-slate-400">
              <span>Per-Order Limit:</span>
              <span className="font-bold text-slate-900 dark:text-slate-100">₹{perOrderLimitRupees.toLocaleString('en-IN')}</span>
            </div>
          </div>
        </div>

        {/* Configuration & Directive Launcher */}
        <div className="rounded-3xl bg-white dark:bg-[#0f172a] border border-slate-200 dark:border-slate-800 p-6 sm:p-8 shadow-sm space-y-6">
          <div>
            <label htmlFor="directive" className="block text-sm font-bold text-slate-800 dark:text-slate-200 mb-2">
              Agent Procurement Directive
            </label>
            <div className="flex flex-col sm:flex-row gap-3">
              <input
                id="directive"
                type="text"
                value={directive}
                onChange={(e) => setDirective(e.target.value)}
                placeholder="e.g. Procure mechanical keyboard under ₹10,000 INR"
                className="flex-1 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/60 px-4 py-3.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-amber-500"
                disabled={isPending}
              />
              <button
                onClick={handleLaunch}
                disabled={isPending}
                className="flex items-center justify-center gap-2 px-6 py-3.5 rounded-2xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white font-bold text-sm shadow-md shadow-amber-500/20 disabled:opacity-50 transition-all cursor-pointer shrink-0"
              >
                {isPending ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                    <span>Executing A2A Lifecycle...</span>
                  </>
                ) : (
                  <>
                    <span>⚡</span>
                    <span>Launch Autonomous Agent</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Quick Directive Presets */}
          <div>
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider block mb-2.5">
              Quick Directives
            </span>
            <div className="flex flex-wrap gap-2">
              {DIRECTIVE_PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => setDirective(preset.directive)}
                  className={`text-xs px-3.5 py-2 rounded-xl border transition-all ${
                    directive === preset.directive
                      ? 'border-amber-500 bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 font-bold shadow-sm'
                      : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 text-slate-600 dark:text-slate-300'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          {/* Warning / Error notice */}
          {error && (
            <div className="p-4 rounded-2xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 text-red-700 dark:text-red-300 text-xs flex items-center justify-between gap-4">
              <span>{error}</span>
              {!settings.enabled && (
                <button
                  onClick={() => setIsModalOpen(true)}
                  className="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white font-bold text-xs shrink-0"
                >
                  Open Settings
                </button>
              )}
            </div>
          )}
        </div>

        {/* Live Execution Stepper (Shows 7 steps when running or completed) */}
        {(isPending || runResult) && (
          <div className="rounded-3xl bg-white dark:bg-[#0f172a] border border-slate-200 dark:border-slate-800 p-6 sm:p-8 shadow-sm space-y-6 animate-fade-in">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-4">
              <div>
                <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                  A2A Autonomous Commerce Lifecycle
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Step-by-step cryptographic machine-to-machine checkout execution
                </p>
              </div>

              <div className="flex items-center gap-2">
                {runResult?.success ? (
                  <span className="px-3 py-1 rounded-full text-xs font-bold bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-800">
                    ✔ 7/7 Lifecycle Steps Succeeded
                  </span>
                ) : isPending ? (
                  <span className="px-3 py-1 rounded-full text-xs font-bold bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 border border-amber-300 dark:border-amber-800 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-amber-500 animate-ping"></span>
                    Executing Steps...
                  </span>
                ) : (
                  <span className="px-3 py-1 rounded-full text-xs font-bold bg-red-50 dark:bg-red-950/60 text-red-600 dark:text-red-400 border border-red-300 dark:border-red-800">
                    Execution Halted
                  </span>
                )}
              </div>
            </div>

            {/* Stepper Cards */}
            <div className="space-y-4">
              {(runResult?.steps ?? [
                { step: 1, title: 'Agent Identity & Spending Ceiling Assertion', status: 'PENDING', message: 'Verifying autonomous credentials...', details: {} },
                { step: 2, title: 'Catalog Discovery & Machine Evaluation', status: 'PENDING', message: 'Querying catalog APIs...', details: {} },
                { step: 3, title: 'Autonomous Basket Composition', status: 'PENDING', message: 'Forming active basket...', details: {} },
                { step: 4, title: 'Offer Generation with HMAC Basket Binding', status: 'PENDING', message: 'Sealing cryptographic snapshot digest...', details: {} },
                { step: 5, title: 'Tamper-Resistance Assertion (Simulated Price Injection)', status: 'PENDING', message: 'Testing mathematical price immutability...', details: {} },
                { step: 6, title: 'Pre-Authorized Offer Acceptance & Merkle Audit', status: 'PENDING', message: 'Transitioning offer and logging block...', details: {} },
                { step: 7, title: 'Razorpay Checkout Order Contract Creation', status: 'PENDING', message: 'Creating provider order...', details: {} },
              ]).map((stepItem) => (
                <div
                  key={stepItem.step}
                  className={`p-4 rounded-2xl border transition-all ${
                    stepItem.status === 'SUCCESS'
                      ? 'border-emerald-200 dark:border-emerald-900/40 bg-emerald-50/30 dark:bg-emerald-950/20'
                      : stepItem.status === 'FAILED'
                      ? 'border-red-200 dark:border-red-900/40 bg-red-50/30 dark:bg-red-950/20'
                      : 'border-slate-200 dark:border-slate-800/60 bg-slate-50/50 dark:bg-slate-900/30 opacity-60'
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3">
                      <div className={`w-7 h-7 rounded-xl flex items-center justify-center text-xs font-black shrink-0 mt-0.5 ${
                        stepItem.status === 'SUCCESS'
                          ? 'bg-emerald-500 text-white'
                          : stepItem.status === 'FAILED'
                          ? 'bg-red-500 text-white'
                          : 'bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                      }`}>
                        {stepItem.status === 'SUCCESS' ? '✔' : stepItem.status === 'FAILED' ? '✖' : stepItem.step}
                      </div>

                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                            STEP {stepItem.step}
                          </span>
                          <span className="text-sm font-bold text-slate-900 dark:text-white">
                            {stepItem.title}
                          </span>
                        </div>
                        <p className="text-xs text-slate-600 dark:text-slate-300 mt-1">
                          {stepItem.message}
                        </p>
                      </div>
                    </div>

                    <span className="text-[10px] font-extrabold uppercase tracking-widest px-2 py-0.5 rounded-full border border-current text-slate-400">
                      {stepItem.status}
                    </span>
                  </div>

                  {/* Step Technical Details */}
                  {Object.keys(stepItem.details || {}).length > 0 && (
                    <div className="mt-3 pt-3 border-t border-slate-200/50 dark:border-slate-800/50 flex flex-wrap gap-x-6 gap-y-1 text-[11px] font-mono text-slate-500 dark:text-slate-400">
                      {Object.entries(stepItem.details).map(([k, v]) => (
                        <span key={k}>
                          <strong>{k}:</strong> {String(v)}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Completed Razorpay Contract Card */}
            {runResult?.success && runResult.orderId && runResult.razorpayOrderId && runResult.amountPaise != null && (
              <div className="mt-6 p-6 rounded-2xl bg-gradient-to-br from-emerald-500/10 via-teal-500/5 to-transparent border-2 border-emerald-500/40 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
                      <span className="text-xs font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                        Autonomous Checkout Ready
                      </span>
                    </div>
                    <h3 className="text-lg font-extrabold text-slate-900 dark:text-white">
                      Razorpay Order Established: {runResult.razorpayOrderId}
                    </h3>
                    <p className="text-xs text-slate-600 dark:text-slate-300">
                      Item: <strong>{runResult.skuPurchased?.name}</strong> • Amount: <strong>₹{(runResult.amountPaise / 100).toLocaleString('en-IN')}</strong> • Receipt: {runResult.receipt}
                    </p>
                  </div>

                  {/* 1-Click Razorpay Modal Launch */}
                  <div className="shrink-0">
                    <CheckoutButton
                      orderId={runResult.orderId}
                      razorpayOrderId={runResult.razorpayOrderId}
                      amount={runResult.amountPaise}
                      currency={runResult.currency ?? 'INR'}
                      merchantName="TechNest (Autonomous A2A)"
                    />
                  </div>
                </div>

                <div className="pt-3 border-t border-emerald-500/20 flex flex-wrap items-center justify-between text-xs text-slate-500 dark:text-slate-400 gap-2">
                  <span>Audit Hash: <code className="font-mono bg-emerald-100 dark:bg-emerald-950/60 px-1.5 py-0.5 rounded text-[11px] text-emerald-800 dark:text-emerald-300">{runResult.orderId.slice(0, 16)}...</code></span>
                  <span>Cryptographic Non-Repudiation Verified ✔</span>
                </div>
              </div>
            )}
          </div>
        )}

      </main>

      {/* Autonomous Settings Modal */}
      <AutonomousAgentSettingsModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        initialSettings={settings}
        onUpdated={(newSettings) => setSettings(newSettings)}
      />
    </div>
  )
}
