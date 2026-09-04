import { randomUUID } from 'node:crypto'
import { PaymentReconciliationStatus } from '@prisma/client'
import { prisma } from '@/backend/db/prisma'
import { razorpay } from '@/backend/services/razorpay'
import { processTrustedRazorpayReconciliation } from '@/backend/actions/webhookProcessor'

const CLAIM_LEASE_MS = 5 * 60 * 1000
const MAX_BACKOFF_MS = 6 * 60 * 60 * 1000

type ProviderPayment = {
  id?: unknown
  order_id?: unknown
  amount?: unknown
  currency?: unknown
  status?: unknown
  error_description?: unknown
}

function nextRetry(attemptCount: number) {
  const delay = Math.min(60_000 * 2 ** Math.min(attemptCount, 8), MAX_BACKOFF_MS)
  return new Date(Date.now() + delay)
}

function safeError(error: unknown): string {
  let message: string
  if (error instanceof Error) {
    message = error.message
  } else if (typeof error === 'object' && error !== null) {
    const errObj = error as Record<string, unknown>
    if (errObj.error && typeof errObj.error === 'object' && (errObj.error as Record<string, unknown>).description) {
      message = String((errObj.error as Record<string, unknown>).description)
    } else if (typeof errObj.message === 'string') {
      message = errObj.message
    } else if (typeof errObj.description === 'string') {
      message = errObj.description
    } else {
      try {
        message = JSON.stringify(error)
      } catch {
        message = String(error)
      }
    }
  } else {
    message = String(error)
  }
  return message.replace(/(rzp_[A-Za-z0-9_-]+|gsk_[A-Za-z0-9_-]+)/g, '[REDACTED]').slice(0, 500)
}

function finalProviderPayment(value: ProviderPayment, razorpayOrderId: string) {
  if (
    typeof value.id !== 'string' ||
    value.order_id !== razorpayOrderId ||
    typeof value.amount !== 'number' ||
    !Number.isInteger(value.amount) ||
    typeof value.currency !== 'string' ||
    (value.status !== 'captured' && value.status !== 'failed')
  ) return null

  return {
    id: value.id,
    orderId: value.order_id,
    amount: value.amount,
    currency: value.currency,
    status: value.status,
    errorDescription: typeof value.error_description === 'string' ? value.error_description : null,
  } as const
}

/**
 * Reconciles due payment rows against Razorpay's authenticated Orders API.
 * Each provider read happens after an atomic claim. Network failures and
 * non-final provider states return the row to PENDING with exponential
 * backoff, so recovery does not depend on a browser callback or webhook retry.
 */
export async function processPendingPaymentReconciliations(limit = 20) {
  const now = new Date()
  const staleBefore = new Date(now.getTime() - CLAIM_LEASE_MS)
  const candidates = await prisma.paymentReconciliation.findMany({
    where: {
      OR: [
        { status: PaymentReconciliationStatus.PENDING, nextAttemptAt: { lte: now } },
        { status: PaymentReconciliationStatus.PROCESSING, processingStartedAt: { lt: staleBefore } },
      ],
    },
    orderBy: { nextAttemptAt: 'asc' },
    take: limit,
    select: { id: true },
  })
  const results = await Promise.all(candidates.map(({ id }) => processOnePaymentReconciliation(id, now, staleBefore)))
  return {
    attempted: results.filter((result) => result === 'attempted').length,
    skipped: results.filter((result) => result === 'skipped').length,
    resolved: results.filter((result) => result === 'resolved').length,
  }
}

async function processOnePaymentReconciliation(
  reconciliationId: string,
  now: Date,
  staleBefore: Date,
): Promise<'attempted' | 'skipped' | 'resolved'> {
  const processingToken = randomUUID()
  const claimed = await prisma.paymentReconciliation.updateMany({
    where: {
      id: reconciliationId,
      OR: [
        { status: PaymentReconciliationStatus.PENDING, nextAttemptAt: { lte: now } },
        { status: PaymentReconciliationStatus.PROCESSING, processingStartedAt: { lt: staleBefore } },
      ],
    },
    data: {
      status: PaymentReconciliationStatus.PROCESSING,
      processingToken,
      processingStartedAt: now,
      attemptCount: { increment: 1 },
    },
  })
  if (claimed.count !== 1) return 'skipped'

  const reconciliation = await prisma.paymentReconciliation.findUniqueOrThrow({
    where: { id: reconciliationId },
    include: {
      order: {
        select: {
          id: true,
          merchantId: true,
          razorpayOrderId: true,
          createdAt: true,
          status: true,
          totalAmount: true,
        },
      },
    },
  })
  const razorpayOrderId = reconciliation.order.razorpayOrderId

  try {
    if (!razorpayOrderId) throw new Error('Internal order has no persisted Razorpay order id')
    
    // Protect against daemon lock exhaustion if the Razorpay API hangs
    const response = await Promise.race([
      razorpay.orders.fetchPayments(razorpayOrderId),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Razorpay API connection timed out during reconciliation.')), 10000))
    ])
    const payments = Array.isArray(response.items) ? response.items as ProviderPayment[] : []
    
    // Filter all well-formed final provider payments
    const validFinalPayments = payments
      .map((item) => finalProviderPayment(item, razorpayOrderId))
      .filter((item): item is NonNullable<typeof item> => Boolean(item))

    // 1. RECOVERY INVARIANT: Prefer ANY captured payment over prior or subsequent failed attempts
    const capturedPayment = validFinalPayments.find((item) => item.status === 'captured')

    let payment: typeof capturedPayment | null = null

    if (capturedPayment) {
      payment = capturedPayment
    } else {
      // Check if there are active in-flight payments (e.g. authorized or created)
      const hasInFlightPayments = payments.some(
        (p) => typeof p.status === 'string' && (p.status === 'authorized' || p.status === 'created')
      )
      if (hasInFlightPayments) {
        throw new Error('Razorpay has not reported a final payment outcome yet')
      }

      // Check authoritative Razorpay order status if supported
      if (typeof razorpay.orders?.fetch === 'function') {
        const providerOrder = await Promise.race([
          razorpay.orders.fetch(razorpayOrderId),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000)),
        ]).catch(() => null) as { status?: unknown; amount_paid?: unknown } | null

        if (providerOrder?.status === 'paid' || (Number(providerOrder?.amount_paid) || 0) > 0) {
          throw new Error('Razorpay order is marked paid; awaiting captured payment propagation')
        }
      }

      // If all recorded attempts are failed:
      if (validFinalPayments.length > 0 && validFinalPayments.every((p) => p.status === 'failed')) {
        const orderCreatedAt = reconciliation.order.createdAt ? new Date(reconciliation.order.createdAt) : null
        const orderAgeMs = orderCreatedAt ? Date.now() - orderCreatedAt.getTime() : Infinity
        const isWithinRetryWindow = orderAgeMs < 15 * 60 * 1000 && reconciliation.attemptCount < 3 && reconciliation.order.status === 'PAYMENT_PENDING'

        if (isWithinRetryWindow) {
          throw new Error('Payment attempt failed, but checkout retry window is active; scheduled retry')
        }

        // All attempts have failed and checkout retry window has elapsed
        payment = validFinalPayments[validFinalPayments.length - 1]
      }
    }

    if (!payment) throw new Error('Razorpay has not reported a final payment outcome yet')

    await processTrustedRazorpayReconciliation(payment)
    const settled = await prisma.$transaction(async (tx) => {
      const result = await tx.paymentReconciliation.updateMany({
        where: { id: reconciliation.id, status: PaymentReconciliationStatus.PROCESSING, processingToken },
        data: {
          status: PaymentReconciliationStatus.RESOLVED,
          processingToken: null,
          processingStartedAt: null,
          resolvedAt: new Date(),
          lastError: null,
        },
      })
      if (result.count !== 1) return false
      await tx.auditLog.create({
        data: {
          merchantId: reconciliation.order.merchantId,
          orderId: reconciliation.order.id,
          action: 'PAYMENT_RECONCILED',
          status: 'EXECUTED',
          reason: 'Scheduled worker reconciled a final Razorpay payment outcome after webhook-independent provider verification.',
          details: { reconciliationId: reconciliation.id, razorpayOrderId, razorpayPaymentId: payment.id, providerStatus: payment.status },
        },
      })
      return true
    })
    return settled ? 'resolved' : 'skipped'
  } catch (error) {
    const lastError = safeError(error)
    await prisma.$transaction(async (tx) => {
      const rescheduled = await tx.paymentReconciliation.updateMany({
        where: { id: reconciliation.id, status: PaymentReconciliationStatus.PROCESSING, processingToken },
        data: {
          status: PaymentReconciliationStatus.PENDING,
          processingToken: null,
          processingStartedAt: null,
          nextAttemptAt: nextRetry(reconciliation.attemptCount),
          lastError,
        },
      })
      if (rescheduled.count !== 1) return
      await tx.auditLog.create({
        data: {
          merchantId: reconciliation.order.merchantId,
          orderId: reconciliation.order.id,
          action: 'PAYMENT_RECONCILIATION_RETRY_SCHEDULED',
          status: 'PENDING',
          reason: 'Razorpay payment reconciliation did not reach a final outcome; retry scheduled with exponential backoff.',
          details: { reconciliationId: reconciliation.id, razorpayOrderId, lastError },
        },
      })
    })
    return 'attempted'
  }
}
