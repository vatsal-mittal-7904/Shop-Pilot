import { OrderStatus, PaymentStatus, OfferStatus } from '@prisma/client'
import { prisma } from '@/backend/db/prisma'
import { razorpay } from '@/backend/services/razorpay'

export const STALE_ORDER_THRESHOLD_MS = 30 * 60 * 1000 // 30 minutes

type ProviderPayment = {
  id?: unknown
  order_id?: unknown
  amount?: unknown
  currency?: unknown
  status?: unknown
}

export type ProviderPaymentCheckResult = 'CAPTURED' | 'NOT_CAPTURED' | 'PROVIDER_ERROR'

/**
 * Authoritatively queries Razorpay for any captured payment against a given provider order ID.
 *
 * CRITICAL MONEY INVARIANT:
 * On any network error, 5xx, or provider exception, this MUST return 'PROVIDER_ERROR'.
 * Expiry workers must NEVER assume "no capture" when the provider read fails (fail-closed).
 */
export async function getProviderPaymentStatus(razorpayOrderId: string): Promise<ProviderPaymentCheckResult> {
  try {
    const response = await razorpay.orders.fetchPayments(razorpayOrderId)
    const payments = Array.isArray(response.items) ? (response.items as ProviderPayment[]) : []
    const hasCaptured = payments.some((p) => p.status === 'captured')
    return hasCaptured ? 'CAPTURED' : 'NOT_CAPTURED'
  } catch (error) {
    console.error(`[ORDER_EXPIRY:PROVIDER_ERROR] Failed to fetch payments for Razorpay order ${razorpayOrderId}:`, error)
    return 'PROVIDER_ERROR'
  }
}

/**
 * Periodically identifies stale, unpaid orders in PAYMENT_PENDING status,
 * authoritatively verifies with Razorpay that NO captured payment exists,
 * transitions them to EXPIRED, and records an AuditLog entry documenting
 * the release of the reserved buyer budget.
 */
export async function expireStaleOrders(options: {
  staleThresholdMs?: number
  limit?: number
  now?: Date
} = {}) {
  const now = options.now ?? new Date()
  const thresholdMs = options.staleThresholdMs ?? STALE_ORDER_THRESHOLD_MS
  const staleThresholdDate = new Date(now.getTime() - thresholdMs)
  const limit = options.limit ?? 50

  const staleCandidates = await prisma.order.findMany({
    where: {
      status: OrderStatus.PAYMENT_PENDING,
      OR: [
        { createdAt: { lte: staleThresholdDate } },
        { offer: { expiresAt: { lte: now } } },
      ],
    },
    include: {
      offer: { select: { id: true, status: true, expiresAt: true } },
    },
    take: limit,
    orderBy: { createdAt: 'asc' },
  })

  let expiredCount = 0
  let skippedErrorCount = 0
  let capturedPendingCount = 0
  const expiredOrderIds: string[] = []

  for (const order of staleCandidates) {
    // If Razorpay order exists, authoritatively check payment status
    if (order.razorpayOrderId) {
      const providerStatus = await getProviderPaymentStatus(order.razorpayOrderId)

      if (providerStatus === 'CAPTURED') {
        // Captured payment exists: retain PAYMENT_PENDING for settlement worker
        capturedPendingCount++
        continue
      }

      if (providerStatus === 'PROVIDER_ERROR') {
        // Fail-closed around money: do NOT expire on provider read errors
        skippedErrorCount++
        console.warn(`[ORDER_EXPIRY:SKIPPED] Retaining PAYMENT_PENDING for order ${order.id} due to provider read failure.`)
        continue
      }
    }

    // Atomically expire order, pending payment, offer, and write audit log
    const expired = await prisma.$transaction(async (tx) => {
      const updateResult = await tx.order.updateMany({
        where: { id: order.id, status: OrderStatus.PAYMENT_PENDING },
        data: { status: OrderStatus.EXPIRED },
      })

      if (updateResult.count === 0) return false

      await tx.payment.updateMany({
        where: { orderId: order.id, status: PaymentStatus.PENDING },
        data: { status: PaymentStatus.FAILED },
      })

      if (order.offerId) {
        await tx.offer.updateMany({
          where: { id: order.offerId, status: { in: [OfferStatus.ACTIVE, OfferStatus.ACCEPTED] } },
          data: { status: OfferStatus.EXPIRED },
        })
      }

      await tx.auditLog.create({
        data: {
          merchantId: order.merchantId,
          orderId: order.id,
          action: 'ORDER_EXPIRED',
          status: 'EXECUTED',
          reason: 'Authoritatively verified unpaid order transitioned to EXPIRED. Account spend capacity released.',
          details: {
            orderId: order.id,
            customerId: order.customerId,
            totalAmount: order.totalAmount,
            razorpayOrderId: order.razorpayOrderId,
            orderCreatedAt: order.createdAt.toISOString(),
            expiredAt: now.toISOString(),
          },
        },
      })

      return true
    })

    if (expired) {
      expiredCount++
      expiredOrderIds.push(order.id)
    }
  }

  return {
    expiredCount,
    expiredOrderIds,
    skippedErrorCount,
    capturedPendingCount,
    evaluatedCount: staleCandidates.length,
  }
}
