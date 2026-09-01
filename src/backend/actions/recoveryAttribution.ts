import { prisma } from '@/backend/db/prisma'
import { Prisma } from '@prisma/client'
import { z } from 'zod'

/**
 * Strict attribution: only a paid order tied to an offer dispatched from a
 * completed RECOVERY campaign counts. Ordinary offers, chat offers, and broad
 * cart conversions never enter this metric.
 */
export async function getRecoveryAttribution(merchantId: string) {
  const parsedMerchantId = z.string().uuid().parse(merchantId)
  // Keep the database predicate scalar-only. The currently running Prisma
  // client rejects nested optional-relation filters (`offer.is...`) despite
  // the generated typings accepting them. The final attribution condition is
  // applied below to the selected relation data instead.
  const where: Prisma.OrderWhereInput = {
    merchantId: parsedMerchantId,
    status: 'PAID' as const,
  }
  // Prisma 7's client-engine adapter in this local runtime rejects aggregate
  // selections even though the generated TypeScript accepts them. This metric
  // is bounded to completed recovery orders, so select the one scalar we need
  // and total it in application code instead of letting an optional dashboard
  // metric crash the merchant workspace.
  const orders = await prisma.order.findMany({
    where,
    select: {
      totalAmount: true,
      offer: {
        select: {
          campaign: { select: { type: true, status: true } },
        },
      },
    },
  })
  const recoveredOrders = orders.filter(
    (order) => order.offer?.campaign?.type === 'RECOVERY' && order.offer.campaign.status === 'COMPLETED',
  )
  return {
    revenue: recoveredOrders.reduce((sum, order) => sum + order.totalAmount, 0),
    recoveredOrders: recoveredOrders.length,
  }
}
