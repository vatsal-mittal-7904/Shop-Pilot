'use client'

import { useState, useTransition } from 'react'
import { updateAutonomousSettings } from '@/backend/actions/autonomousMode'
import type { CustomerAutonomousSettings } from './AgentSessionProvider'

interface AutonomousAgentSettingsModalProps {
  isOpen: boolean
  onClose: () => void
  initialSettings: CustomerAutonomousSettings
  onUpdated: (newSettings: CustomerAutonomousSettings) => void
}

export function AutonomousAgentSettingsModal({
  isOpen,
  onClose,
  initialSettings,
  onUpdated,
}: AutonomousAgentSettingsModalProps) {
  const [enabled, setEnabled] = useState(initialSettings.enabled)
  const [ceilingRupees, setCeilingRupees] = useState<number | string>(
    initialSettings.autonomousSpendCeilingPaise != null
      ? initialSettings.autonomousSpendCeilingPaise / 100
      : 10000
  )
  const [perOrderCapRupees, setPerOrderCapRupees] = useState<number | string>(
    initialSettings.maxOrderSpendLimitPaise != null
      ? initialSettings.maxOrderSpendLimitPaise / 100
      : 5000
  )
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [isPending, startTransition] = useTransition()

  if (!isOpen) return null

  const handleSave = () => {
    setError(null)
    setSuccess(false)

    const ceiling = Number(ceilingRupees)
    const perOrder = Number(perOrderCapRupees)

    if (enabled) {
      if (isNaN(ceiling) || ceiling <= 0) {
        setError('Please enter a valid autonomous spend ceiling in ₹.')
        return
      }
      if (isNaN(perOrder) || perOrder <= 0) {
        setError('Please enter a valid per-order spend cap in ₹.')
        return
      }
      if (perOrder > ceiling) {
        setError('Per-order spend cap cannot exceed the autonomous spend ceiling.')
        return
      }
      const maxDailyRupees = initialSettings.dailySpendLimitPaise / 100
      if (ceiling > maxDailyRupees) {
        setError(`Spend ceiling cannot exceed account daily limit of ₹${maxDailyRupees.toLocaleString('en-IN')}.`)
        return
      }
    }

    startTransition(async () => {
      try {
        const res = await updateAutonomousSettings({
          enabled,
          spendCeilingPaise: enabled ? Math.round(Number(ceilingRupees) * 100) : null,
          maxOrderSpendLimitPaise: enabled ? Math.round(Number(perOrderCapRupees) * 100) : null,
        })
        if (res.success) {
          setSuccess(true)
          onUpdated({
            enabled: res.enabled,
            autonomousSpendCeilingPaise: res.autonomousSpendCeilingPaise,
            maxOrderSpendLimitPaise: res.maxOrderSpendLimitPaise,
            dailySpendLimitPaise: res.dailySpendLimitPaise,
          })
          setTimeout(() => {
            onClose()
          }, 800)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to update autonomous settings.')
      }
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in">
      <div className="relative w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-[#0f172a] text-slate-900 dark:text-slate-100">
        
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800/80 pb-4 mb-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
              <span className="text-xl">⚡</span>
            </div>
            <div>
              <h2 className="text-lg font-bold">Autonomous Buyer Agent</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Agent-to-Agent (A2A) Policy & Spend Boundaries
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-xl p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="space-y-5">
          {/* Toggle */}
          <div className="flex items-center justify-between p-4 rounded-2xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200/60 dark:border-slate-800">
            <div>
              <div className="font-semibold text-sm">Autonomous Checkout Mode</div>
              <div className="text-xs text-slate-500 dark:text-slate-400 max-w-[280px]">
                Allow the agent to pre-authorize offers and create Razorpay checkouts without manual click confirmation.
              </div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-12 h-6 bg-slate-300 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-slate-600 peer-checked:bg-indigo-600"></div>
            </label>
          </div>

          {enabled && (
            <div className="space-y-4 pt-1 animate-fade-in">
              {/* Spend Ceiling */}
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">
                  Autonomous Daily Ceiling (₹)
                </label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 font-medium">₹</span>
                  <input
                    type="number"
                    value={ceilingRupees}
                    onChange={(e) => setCeilingRupees(e.target.value)}
                    min={100}
                    max={initialSettings.dailySpendLimitPaise / 100}
                    className="w-full pl-8 pr-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                    placeholder="10000"
                  />
                </div>
                <div className="text-[11px] text-slate-500 mt-1">
                  Hard account ceiling: ₹{(initialSettings.dailySpendLimitPaise / 100).toLocaleString('en-IN')}
                </div>
              </div>

              {/* Per-Order Cap */}
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">
                  Per-Order Limit (₹)
                </label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 font-medium">₹</span>
                  <input
                    type="number"
                    value={perOrderCapRupees}
                    onChange={(e) => setPerOrderCapRupees(e.target.value)}
                    min={100}
                    className="w-full pl-8 pr-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                    placeholder="5000"
                  />
                </div>
                <div className="text-[11px] text-slate-500 mt-1">
                  Offers exceeding this limit automatically require manual customer confirmation.
                </div>
              </div>

              {/* Security Invariant Callout */}
              <div className="p-3 rounded-xl bg-indigo-50/70 dark:bg-indigo-950/30 border border-indigo-200/50 dark:border-indigo-900/40 text-xs text-indigo-900 dark:text-indigo-300 space-y-1">
                <div className="font-semibold flex items-center gap-1.5">
                  <span>🛡️ Deterministic Spend Boundary</span>
                </div>
                <p className="text-[11px] leading-relaxed text-indigo-800 dark:text-indigo-300/80">
                  The AI model cannot modify pricing or bypass these ceilings. Any attempt to purchase an item above ₹{Number(perOrderCapRupees || 0).toLocaleString('en-IN')} drops gracefully to explicit human approval.
                </p>
              </div>
            </div>
          )}

          {error && (
            <div className="p-3 rounded-xl bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300 border border-rose-200 dark:border-rose-900/50 text-xs">
              {error}
            </div>
          )}

          {success && (
            <div className="p-3 rounded-xl bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-900/50 text-xs flex items-center gap-2">
              <span>✔</span> Settings saved and cryptographic audit trail updated.
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="mt-6 pt-4 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isPending}
            className="px-5 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-xl shadow-sm transition disabled:opacity-50 flex items-center gap-1.5"
          >
            {isPending ? 'Saving…' : 'Save Policy Settings'}
          </button>
        </div>

      </div>
    </div>
  )
}
