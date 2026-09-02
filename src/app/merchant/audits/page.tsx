import Link from 'next/link'
import { requireMerchant } from '@/backend/auth/session'
import { prisma } from '@/backend/db/prisma'
import { getAuditChainHealth } from '@/backend/actions/auditExport'
import AuditLogClient from './AuditLogClient'

export default async function MerchantAuditsPage() {
  const { merchant } = await requireMerchant()

  const [logs, health] = await Promise.all([
    prisma.auditLog.findMany({
      where: { merchantId: merchant.id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 200,
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
    }),
    getAuditChainHealth(merchant.id),
  ])

  const serializedLogs = logs.map((log) => ({
    id: log.id,
    action: log.action,
    status: log.status,
    reason: log.reason,
    details: log.details,
    orderId: log.orderId,
    previousHash: log.previousHash,
    entryHash: log.entryHash,
    actorName: log.actorUser?.name || log.actorUser?.email || null,
    createdAt: log.createdAt.toISOString(),
  }))

  return (
    <div className="min-h-screen bg-transparent pt-24 pb-16 text-slate-800 dark:text-slate-200">
      <main className="max-w-7xl mx-auto px-6 lg:px-8">
        <div className="mb-6 flex items-center justify-between">
          <Link
            href="/merchant/portal"
            className="inline-flex items-center text-sm font-semibold text-indigo-600 dark:text-indigo-400 hover:underline gap-1"
          >
            ← Back to Merchant Hub
          </Link>
          <span className="text-xs font-mono text-slate-400">
            Merchant: {merchant.name} ({merchant.id.slice(0, 8)}…)
          </span>
        </div>

        <div className="mb-8">
          <p className="text-xs font-bold uppercase tracking-widest text-indigo-600 dark:text-indigo-400">
            Regulatory & Cryptographic Non-Repudiation Trail
          </p>
          <h1 className="mt-2 text-4xl font-extrabold text-slate-900 dark:text-white tracking-tight">
            Compliance & Audit Center
          </h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
            Append-only cryptographic event ledger protected by PostgreSQL triggers. Every transaction, AI discount decision, state transition, and security event is sequentially hashed with SHA-256 for non-repudiation and regulatory compliance.
          </p>
        </div>

        <AuditLogClient initialLogs={serializedLogs} health={health} />
      </main>
    </div>
  )
}
