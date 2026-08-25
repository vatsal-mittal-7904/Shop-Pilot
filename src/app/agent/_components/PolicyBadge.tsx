'use client'

import { useState } from 'react'
import { z } from 'zod'
import type { AgentActionSummary } from '@/backend/actions/explainability'

/**
 * The exact contract evaluateDiscount() (policyEngine.ts) returns, and what
 * every DISCOUNT_OFFER AgentAction.policyResult is populated with. Parsed
 * defensively here rather than trusted as-is: AgentActionSummary types
 * policyResult as `unknown` because it's a Json column with no DB-level
 * shape guarantee.
 */
const policyResultSchema = z.object({
  checked: z.array(z.string()),
  passed: z.boolean(),
  limit: z.number(),
  requested: z.number(),
  reason: z.string(),
})

function parsePolicyResult(raw: unknown) {
  const result = policyResultSchema.safeParse(raw)
  return result.success ? result.data : null
}

/**
 * Visual debugger for a single policy-gated AgentAction, meant to sit inline
 * in (or right next to) the chat transcript wherever the agent surfaced a
 * discount/bundle decision. Only renders for APPROVED or BLOCKED actions --
 * those are the two statuses that carry a real policy verdict; other
 * statuses (PROPOSED, EXECUTED, REJECTED) aren't policy outcomes and have
 * nothing meaningful to show here.
 *
 * The "Details" expander shows the raw policyResult JSON verbatim -- not a
 * paraphrase or a re-derived summary -- specifically so it can stand as
 * proof this was a deterministic policy-engine evaluation (checked/limit/
 * requested/passed) and not something the model asserted on its own.
 */
export default function PolicyBadge({ action }: { action: AgentActionSummary }) {
  const [detailsOpen, setDetailsOpen] = useState(false)

  const isApproved = action.status === 'APPROVED'
  const isBlocked = action.status === 'BLOCKED'
  if (!isApproved && !isBlocked) return null

  const policyResult = parsePolicyResult(action.policyResult)
  if (!policyResult) return null
  const reason = policyResult.reason

  const palette = isApproved
    ? { wrap: 'bg-emerald-50 border-emerald-200', text: 'text-emerald-800', icon: 'text-emerald-600' }
    : { wrap: 'bg-rose-50 border-rose-200', text: 'text-rose-800', icon: 'text-rose-600' }

  return (
    <div className={`inline-flex max-w-sm flex-col gap-1.5 rounded-xl border px-3 py-2 text-xs ${palette.wrap}`}>
      <div className="flex items-start gap-2">
        {isApproved ? (
          <svg className={`mt-0.5 h-4 w-4 shrink-0 ${palette.icon}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        ) : (
          <svg className={`mt-0.5 h-4 w-4 shrink-0 ${palette.icon}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
            />
          </svg>
        )}
        <span className={`font-medium leading-snug ${palette.text}`}>
          {isApproved ? 'Policy Check Passed: ' : 'Policy Check Failed: '}
          {reason}
        </span>
      </div>

      {policyResult && (
        <div>
          <button
            type="button"
            onClick={() => setDetailsOpen((open) => !open)}
            aria-expanded={detailsOpen}
            className={`font-medium underline decoration-dotted underline-offset-2 hover:opacity-75 ${palette.text}`}
          >
            {detailsOpen ? 'Hide details' : 'Details'}
          </button>
          {detailsOpen && (
            <pre className="mt-1.5 overflow-x-auto rounded-lg bg-white/70 p-2 font-mono text-[11px] leading-relaxed text-slate-700">
              {JSON.stringify(action.policyResult, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}
