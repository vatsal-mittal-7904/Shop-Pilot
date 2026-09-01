import { createHmac } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '@/backend/db/prisma'
import { requireMerchant } from '@/backend/auth/session'

/** Creates an immutable, signed snapshot of the merchant's audit ledger. */
export async function createAuditExport() {
  const { merchant } = await requireMerchant()
  const logs = await prisma.auditLog.findMany({
    where: { merchantId: merchant.id },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true, orderId: true, actorUserId: true, action: true, reason: true, details: true, status: true, previousHash: true, entryHash: true, createdAt: true },
  })
  const payload = {
    format: 'merchantos.audit-export.v1',
    merchantId: merchant.id,
    exportedAt: new Date().toISOString(),
    entries: logs.map((log) => ({ ...log, createdAt: log.createdAt.toISOString() })),
  }
  const chainHead = logs.at(-1)?.entryHash ?? 'GENESIS'
  const secret = process.env.AUDIT_EXPORT_SECRET || process.env.OFFER_BINDING_SECRET || process.env.RAZORPAY_KEY_SECRET
  if (!secret) throw new Error('AUDIT_EXPORT_SECRET must be configured before creating an audit export.')
  const signature = createHmac('sha256', secret).update(JSON.stringify(payload)).digest('hex')
  const auditExport = await prisma.auditExport.create({
    data: { merchantId: merchant.id, payload: payload as Prisma.InputJsonValue, chainHead, signature },
    select: { id: true, chainHead: true, signature: true, createdAt: true },
  })
  return { ...auditExport, payload }
}
