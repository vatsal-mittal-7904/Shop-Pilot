import Link from 'next/link'
import { requireMerchant } from '@/backend/auth/session'
import { prisma } from '@/backend/db/prisma'

const statusClass: Record<string, string> = {
  EXECUTED: 'bg-emerald-100 text-emerald-800',
  APPROVED: 'bg-emerald-100 text-emerald-800',
  PENDING: 'bg-amber-100 text-amber-800',
  FAILED: 'bg-rose-100 text-rose-800',
  REJECTED: 'bg-rose-100 text-rose-800',
}

export default async function MerchantAuditsPage() {
  const { merchant } = await requireMerchant()
  const logs = await prisma.auditLog.findMany({
    where: { merchantId: merchant.id },
    orderBy: { createdAt: 'desc' },
    take: 100,
    select: {
      id: true,
      action: true,
      status: true,
      reason: true,
      details: true,
      orderId: true,
      previousHash: true,
      entryHash: true,
      actorUser: { select: { name: true, email: true } },
      createdAt: true,
    },
  })

  return (
    <div className="min-h-screen bg-transparent pt-24 pb-12 text-slate-800 dark:text-slate-200">
      <main className="max-w-6xl mx-auto px-6 lg:px-8">
        <Link href="/merchant/portal" className="inline-flex items-center text-sm font-medium text-indigo-600 dark:text-indigo-400 hover:underline">
          ← Back to Merchant Hub
        </Link>
        <div className="mt-6 mb-8">
          <p className="text-xs font-bold uppercase tracking-widest text-amber-600">Merchant-scoped evidence</p>
          <h1 className="mt-2 text-4xl font-extrabold text-slate-900 dark:text-white tracking-tight">System Audits</h1>
          <p className="mt-2 max-w-3xl text-slate-600 dark:text-slate-400">
            Database-enforced append-only events for this merchant. Each new entry is hash-chained; changes and deletions are rejected by PostgreSQL after the audit-ledger migration is applied.
          </p>
        </div>

        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white/90 shadow-sm dark:border-slate-800 dark:bg-[#0f1629]/80">
          {logs.length === 0 ? (
            <div className="px-6 py-16 text-center">
              <p className="font-semibold text-slate-900 dark:text-white">No audit events yet</p>
              <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Product changes, policy decisions, campaign actions, and payment events will appear here.</p>
            </div>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {logs.map((log) => (
                <li key={log.id} className="px-6 py-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="font-semibold text-slate-900 dark:text-white">{log.action}</h2>
                      <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{log.reason ?? 'No reason recorded.'}</p>
                    </div>
                    <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${statusClass[log.status] ?? 'bg-slate-100 text-slate-700'}`}>{log.status}</span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
                    <span>{log.createdAt.toLocaleString('en-IN')}</span>
                    {log.actorUser && <span>Actor: {log.actorUser.name || log.actorUser.email}</span>}
                    {log.orderId && <span className="font-mono">Order: {log.orderId}</span>}
                    {log.entryHash && <span className="font-mono">Hash: {log.entryHash.slice(0, 16)}…</span>}
                  </div>
                  {log.details && (
                    <details className="mt-3">
                      <summary className="cursor-pointer text-xs font-semibold text-indigo-600 dark:text-indigo-400">Inspect recorded details</summary>
                      <pre className="mt-2 overflow-x-auto rounded-lg bg-slate-950 p-3 text-xs leading-relaxed text-slate-100">{JSON.stringify(log.details, null, 2)}</pre>
                    </details>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  )
}
