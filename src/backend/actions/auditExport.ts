import { createHmac } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '@/backend/db/prisma'
import { requireMerchant } from '@/backend/auth/session'
import { verifyAuditChain } from '@/backend/security/auditChainVerifier'
import { extractTraceContext } from '@/backend/security/causalityTracer'

export type AuditExportCSVOptions = {
  merchantId?: string
  limit?: number
  action?: string
  status?: string
}

/**
 * Escapes a single string field according to RFC-4180 CSV specifications.
 */
function escapeCSVField(value: unknown): string {
  if (value === null || value === undefined) return '""'
  const str = typeof value === 'object' ? JSON.stringify(value) : String(value)
  // Double internal quotes and wrap in quotes
  return `"${str.replace(/"/g, '""')}"`
}

/**
 * Generates an RFC-4180 compliant CSV export of the merchant's audit trail for accounting,
 * taxation, and regulatory compliance.
 */
export async function exportAuditLedgerCSV(options: AuditExportCSVOptions = {}): Promise<string> {
  let merchantId = options.merchantId

  if (!merchantId) {
    const { merchant } = await requireMerchant()
    merchantId = merchant.id
  }

  const whereClause: Record<string, unknown> = { merchantId }
  if (options.action) whereClause.action = options.action
  if (options.status) whereClause.status = options.status

  const logs = await prisma.auditLog.findMany({
    where: whereClause,
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: options.limit ?? 5000,
    select: {
      id: true,
      action: true,
      status: true,
      reason: true,
      orderId: true,
      actorUserId: true,
      details: true,
      previousHash: true,
      entryHash: true,
      createdAt: true,
    },
  })

  const headers = [
    'Log ID',
    'Created At (UTC)',
    'Action',
    'Status',
    'Order ID',
    'Actor User ID',
    'Trace ID',
    'Reason',
    'Details (JSON)',
    'Previous Hash',
    'Entry Hash',
  ]

  const rows = logs.map((log) => {
    const trace = extractTraceContext(log.details)
    return [
      escapeCSVField(log.id),
      escapeCSVField(log.createdAt.toISOString()),
      escapeCSVField(log.action),
      escapeCSVField(log.status),
      escapeCSVField(log.orderId ?? ''),
      escapeCSVField(log.actorUserId ?? ''),
      escapeCSVField(trace.traceId ?? ''),
      escapeCSVField(log.reason ?? ''),
      escapeCSVField(log.details ?? {}),
      escapeCSVField(log.previousHash),
      escapeCSVField(log.entryHash),
    ].join(',')
  })

  return [headers.join(','), ...rows].join('\r\n')
}

/**
 * Returns the real-time cryptographic health scorecard for the merchant's append-only ledger.
 */
export async function getAuditChainHealth(targetMerchantId?: string) {
  let merchantId = targetMerchantId

  if (!merchantId) {
    const { merchant } = await requireMerchant()
    merchantId = merchant.id
  }

  const logs = await prisma.auditLog.findMany({
    where: { merchantId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  })

  const verification = verifyAuditChain(logs)

  return {
    merchantId,
    totalEntries: verification.totalEntries,
    valid: verification.valid,
    genesisVerified: verification.genesisVerified,
    contentDigestVerified: verification.contentDigestVerified,
    chainHead: verification.chainHead,
    integrityStatus: verification.valid ? 'VERIFIED_100_PERCENT' : 'INTEGRITY_COMPROMISED',
    errorCount: verification.errors.length,
    errors: verification.errors,
    checkedAt: new Date().toISOString(),
  }
}

/**
 * Creates an immutable, HMAC-SHA256 signed snapshot of the merchant's audit ledger in PostgreSQL.
 */
export async function createAuditExport(customMerchantId?: string) {
  let merchantId = customMerchantId

  if (!merchantId) {
    const { merchant } = await requireMerchant()
    merchantId = merchant.id
  }

  const logs = await prisma.auditLog.findMany({
    where: { merchantId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      orderId: true,
      actorUserId: true,
      action: true,
      reason: true,
      details: true,
      status: true,
      previousHash: true,
      entryHash: true,
      createdAt: true,
    },
  })

  const verification = verifyAuditChain(logs)

  const payload = {
    format: 'shop-pilot.audit-export.v2',
    merchantId,
    exportedAt: new Date().toISOString(),
    totalEntries: logs.length,
    chainHead: verification.chainHead,
    verificationScorecard: {
      valid: verification.valid,
      genesisVerified: verification.genesisVerified,
      contentDigestVerified: verification.contentDigestVerified,
      errorCount: verification.errors.length,
    },
    entries: logs.map((log) => {
      const trace = extractTraceContext(log.details)
      return {
        ...log,
        traceId: trace.traceId,
        createdAt: log.createdAt.toISOString(),
      }
    }),
  }

  const chainHead = logs.at(-1)?.entryHash ?? 'GENESIS'
  const secret =
    process.env.AUDIT_EXPORT_SECRET ||
    process.env.OFFER_BINDING_SECRET ||
    process.env.RAZORPAY_KEY_SECRET ||
    'demo-audit-export-secret-key-12345678'

  const signature = createHmac('sha256', secret).update(JSON.stringify(payload)).digest('hex')

  const auditExport = await prisma.auditExport.create({
    data: {
      merchantId,
      payload: payload as Prisma.InputJsonValue,
      chainHead,
      signature,
    },
    select: { id: true, chainHead: true, signature: true, createdAt: true },
  })

  return { ...auditExport, payload, verification }
}
