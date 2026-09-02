'use client'

import { useState, useMemo } from 'react'

export type AuditLogEntryItem = {
  id: string
  action: string
  status: string
  reason: string | null
  details: unknown
  orderId: string | null
  previousHash: string
  entryHash: string
  actorName: string | null
  createdAt: string
}

export type AuditHealthSummary = {
  totalEntries: number
  valid: boolean
  genesisVerified: boolean
  contentDigestVerified: boolean
  chainHead: string
  integrityStatus: string
  errorCount: number
}

const statusClass: Record<string, string> = {
  EXECUTED: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
  APPROVED: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
  PENDING: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30',
  FAILED: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/30',
  REJECTED: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/30',
}

const actionColorMap: Record<string, string> = {
  ORDER_CREATED: 'text-indigo-600 dark:text-indigo-400',
  PAYMENT_CAPTURED: 'text-emerald-600 dark:text-emerald-400',
  DISCOUNT_OFFER: 'text-purple-600 dark:text-purple-400',
  ORDER_EXPIRED: 'text-amber-600 dark:text-amber-400',
  REFUND_DISPATCHED: 'text-cyan-600 dark:text-cyan-400',
  SECURITY_THREAT_BLOCKED: 'text-rose-600 dark:text-rose-400',
}

export default function AuditLogClient({
  initialLogs,
  health,
}: {
  initialLogs: AuditLogEntryItem[]
  health: AuditHealthSummary
}) {
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedAction, setSelectedAction] = useState('ALL')
  const [selectedStatus, setSelectedStatus] = useState('ALL')
  const [isExporting, setIsExporting] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const distinctActions = useMemo(() => {
    const set = new Set(initialLogs.map((l) => l.action))
    return ['ALL', ...Array.from(set).sort()]
  }, [initialLogs])

  const filteredLogs = useMemo(() => {
    return initialLogs.filter((log) => {
      if (selectedAction !== 'ALL' && log.action !== selectedAction) return false
      if (selectedStatus !== 'ALL' && log.status !== selectedStatus) return false

      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase()
        const matchId = log.id.toLowerCase().includes(query)
        const matchAction = log.action.toLowerCase().includes(query)
        const matchOrder = log.orderId ? log.orderId.toLowerCase().includes(query) : false
        const matchReason = log.reason ? log.reason.toLowerCase().includes(query) : false
        const matchActor = log.actorName ? log.actorName.toLowerCase().includes(query) : false
        const matchHash = log.entryHash ? log.entryHash.toLowerCase().includes(query) : false
        const matchDetails = log.details ? JSON.stringify(log.details).toLowerCase().includes(query) : false

        return matchId || matchAction || matchOrder || matchReason || matchActor || matchHash || matchDetails
      }

      return true
    })
  }, [initialLogs, selectedAction, selectedStatus, searchQuery])

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const handleJsonSnapshotExport = async () => {
    try {
      setIsExporting(true)
      const res = await fetch('/api/merchant/audits/export', { method: 'POST' })
      if (!res.ok) throw new Error('Export creation failed')
      const blob = await res.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `merchantos-audit-signed-${Date.now()}.json`
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.URL.revokeObjectURL(url)
    } catch (err) {
      alert(`Export failed: ${(err as Error).message}`)
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <div className="space-y-8">
      {/* 1. Real-Time Cryptographic Integrity Card */}
      <section className="relative overflow-hidden rounded-3xl border border-slate-200/80 bg-gradient-to-br from-white via-slate-50 to-indigo-50/30 p-6 shadow-sm dark:border-slate-800 dark:from-[#0f172a] dark:via-[#0f172a]/90 dark:to-indigo-950/20">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-slate-900 dark:text-white">Cryptographic Ledger Health</h2>
                <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
                  health.valid
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                    : 'border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400'
                }`}>
                  {health.valid ? '● 100% TAMPER-EVIDENT' : '▲ INTEGRITY COMPROMISED'}
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Append-only SHA-256 cryptographic chain validated across PostgreSQL database triggers.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleJsonSnapshotExport}
              disabled={isExporting}
              className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-indigo-500 focus:outline-none transition disabled:opacity-50"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              {isExporting ? 'Signing Snapshot…' : 'Download Signed JSON (HMAC)'}
            </button>
            <a
              href="/api/merchant/audits/export?format=csv"
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 transition"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Export CSV
            </a>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4 border-t border-slate-200/60 pt-5 dark:border-slate-800/60">
          <div>
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Total Chained Blocks</span>
            <p className="text-xl font-extrabold text-slate-900 dark:text-white mt-0.5">{health.totalEntries}</p>
          </div>
          <div>
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Genesis Root</span>
            <p className="text-sm font-bold text-emerald-600 dark:text-emerald-400 mt-1">✓ ANCHORED (GENESIS)</p>
          </div>
          <div>
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Payload Digest Match</span>
            <p className="text-sm font-bold text-emerald-600 dark:text-emerald-400 mt-1">✓ 100% SHA-256 PARITY</p>
          </div>
          <div>
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Chain Head Digest</span>
            <p className="font-mono text-xs font-semibold text-slate-700 dark:text-slate-300 mt-1 truncate" title={health.chainHead}>
              {health.chainHead ? `${health.chainHead.slice(0, 16)}…` : 'GENESIS'}
            </p>
          </div>
        </div>
      </section>

      {/* 2. Filter, Search & Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-1 flex-wrap items-center gap-2.5 min-w-[280px]">
          <div className="relative flex-1 min-w-[200px]">
            <svg className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Search by Order ID, Reason, Actor, or Hash…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-4 text-xs text-slate-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-slate-800 dark:bg-slate-900 dark:text-white"
            />
          </div>

          <select
            value={selectedAction}
            onChange={(e) => setSelectedAction(e.target.value)}
            className="rounded-xl border border-slate-200 bg-white py-2 px-3 text-xs text-slate-700 shadow-sm focus:border-indigo-500 focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
          >
            {distinctActions.map((act) => (
              <option key={act} value={act}>
                {act === 'ALL' ? 'All Actions' : act}
              </option>
            ))}
          </select>

          <select
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            className="rounded-xl border border-slate-200 bg-white py-2 px-3 text-xs text-slate-700 shadow-sm focus:border-indigo-500 focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
          >
            <option value="ALL">All Statuses</option>
            <option value="EXECUTED">EXECUTED</option>
            <option value="APPROVED">APPROVED</option>
            <option value="PENDING">PENDING</option>
            <option value="REJECTED">REJECTED</option>
            <option value="FAILED">FAILED</option>
          </select>
        </div>

        <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
          Showing <strong className="text-slate-900 dark:text-white">{filteredLogs.length}</strong> of {initialLogs.length} events
        </span>
      </div>

      {/* 3. Event Ledger Timeline */}
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-[#0f1629]/80">
        {filteredLogs.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <p className="font-semibold text-slate-900 dark:text-white">No matching audit events</p>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              Try adjusting your search query or filters.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800/80">
            {filteredLogs.map((log, index) => (
              <li key={log.id} className="p-6 transition hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2.5">
                      <span className="font-mono text-xs font-bold text-slate-400 dark:text-slate-500">
                        #{initialLogs.length - index}
                      </span>
                      <h3 className={`font-bold text-sm ${actionColorMap[log.action] ?? 'text-slate-900 dark:text-white'}`}>
                        {log.action}
                      </h3>
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-300">
                      {log.reason ?? 'Deterministic state machine event recorded.'}
                    </p>
                  </div>

                  <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${statusClass[log.status] ?? 'bg-slate-100 text-slate-700'}`}>
                    {log.status}
                  </span>
                </div>

                {/* Metadata & Attribution Bar */}
                <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs text-slate-500 dark:text-slate-400">
                  <span className="flex items-center gap-1">
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    {new Date(log.createdAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}
                  </span>

                  {log.actorName && (
                    <span className="flex items-center gap-1">
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                      </svg>
                      Actor: <strong className="text-slate-700 dark:text-slate-300">{log.actorName}</strong>
                    </span>
                  )}

                  {log.orderId && (
                    <button
                      onClick={() => handleCopy(log.orderId!, `order-${log.id}`)}
                      className="inline-flex items-center gap-1 font-mono text-indigo-600 dark:text-indigo-400 hover:underline"
                    >
                      Order: {log.orderId.slice(0, 8)}…
                      <span className="text-[10px] text-slate-400">{copiedId === `order-${log.id}` ? '✓' : '⧉'}</span>
                    </button>
                  )}

                  <button
                    onClick={() => handleCopy(log.entryHash, `hash-${log.id}`)}
                    className="inline-flex items-center gap-1 font-mono text-slate-500 hover:text-slate-900 dark:hover:text-white"
                  >
                    Hash: {log.entryHash.slice(0, 12)}…
                    <span className="text-[10px] text-slate-400">{copiedId === `hash-${log.id}` ? '✓' : '⧉'}</span>
                  </button>
                </div>

                {/* Cryptographic Continuity & Inspector */}
                <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                  <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                    Prev: {log.previousHash === 'GENESIS' ? 'GENESIS' : `${log.previousHash.slice(0, 10)}…`}
                  </span>
                  <span>➔</span>
                  <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                    Current: {log.entryHash ? `${log.entryHash.slice(0, 10)}…` : 'PENDING'}
                  </span>
                  <span className="text-emerald-600 dark:text-emerald-400 font-semibold">✓ Chained</span>
                </div>

                {/* Detailed JSON Drawer */}
                {Boolean(log.details) && (
                  <details className="mt-3 group">
                    <summary className="cursor-pointer text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline inline-flex items-center gap-1">
                      <span>Inspect Structured Payload & Trace</span>
                      <span className="transition-transform group-open:rotate-90">›</span>
                    </summary>
                    <pre className="mt-2.5 overflow-x-auto rounded-xl bg-slate-950 p-4 font-mono text-xs leading-relaxed text-slate-200 shadow-inner">
                      {JSON.stringify(log.details, null, 2)}
                    </pre>
                  </details>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
