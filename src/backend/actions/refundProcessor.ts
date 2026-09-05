import { randomUUID } from 'node:crypto'
import { RefundStatus } from '@prisma/client'
import { prisma } from '@/backend/db/prisma'
import { dispatchOperatorAlert } from '@/backend/notifications/operatorNotifier'
import { notifyCustomerOfDLQ } from '@/backend/notifications/customerNotifier'

const CLAIM_LEASE_MS = 5 * 60 * 1000
const MAX_BACKOFF_MS = 6 * 60 * 60 * 1000
const MAX_REFUND_ATTEMPTS = 5

type RazorpayRefund = { id?: unknown }

/**
 * Makes Razorpay's refund endpoint safe across worker crashes and timeouts.
 * The Refund row id is used for both Razorpay's X-Refund-Idempotency header
 * and its per-payment receipt, so every retry is exactly the same request.
 */
async function createRazorpayRefund({
  paymentId,
  amount,
  refundId,
  reverseAll,
}: {
  paymentId: string
  amount: number
  refundId: string
  reverseAll?: boolean
}): Promise<{ providerRefundId: string }> {
  const keyId = process.env.RAZORPAY_KEY_ID
  const keySecret = process.env.RAZORPAY_KEY_SECRET
  if (!keyId || !keySecret) throw new Error('Razorpay refund credentials are not configured')

  const requestPayload: Record<string, unknown> = {
    amount,
    receipt: `mso_refund_${refundId}`,
    notes: { reason: 'inventory_unavailable', internalRefundId: refundId },
  }
  if (reverseAll) {
    // Razorpay Route Marketplace Architecture:
    // When a merchant subaccount received split settlement via Route, reverse_all claws back
    // the transfer directly from the subaccount balance rather than platform funds.
    requestPayload.reverse_all = 1
  }

  const response = await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(paymentId)}/refund`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`,
      'Content-Type': 'application/json',
      'X-Refund-Idempotency': refundId,
    },
    body: JSON.stringify(requestPayload),
  })

  const body = await response.json().catch(() => null) as RazorpayRefund | { error?: { description?: unknown } } | null
  if (!response.ok) {
    const description = body && 'error' in body && typeof body.error?.description === 'string'
      ? body.error.description
      : `Razorpay refund request failed with HTTP ${response.status}`
    throw new Error(description.slice(0, 500))
  }
  if (!body || !('id' in body) || typeof body.id !== 'string' || !body.id) {
    throw new Error('Razorpay refund response did not include a refund id')
  }
  return { providerRefundId: body.id }
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

/** Processes due refund-outbox rows. Safe to run concurrently from cron. */
export async function processPendingRefunds(limit = 20) {
  const now = new Date()
  const staleBefore = new Date(now.getTime() - CLAIM_LEASE_MS)
  const candidates = await prisma.refund.findMany({
    where: {
      OR: [
        { status: RefundStatus.PENDING, nextAttemptAt: { lte: now } },
        { status: RefundStatus.PROCESSING, processingStartedAt: { lt: staleBefore } },
      ],
    },
    orderBy: { nextAttemptAt: 'asc' },
    take: limit,
    select: { id: true },
  })

  const results = await Promise.all(candidates.map(({ id }) => processOneRefund(id, now, staleBefore)))
  return {
    attempted: results.filter((result) => result === 'attempted').length,
    skipped: results.filter((result) => result === 'skipped').length,
  }
}

async function processOneRefund(refundId: string, now: Date, staleBefore: Date): Promise<'attempted' | 'skipped'> {
  const processingToken = randomUUID()
  const claimed = await prisma.refund.updateMany({
    where: {
      id: refundId,
      OR: [
        { status: RefundStatus.PENDING, nextAttemptAt: { lte: now } },
        { status: RefundStatus.PROCESSING, processingStartedAt: { lt: staleBefore } },
      ],
    },
    data: {
      status: RefundStatus.PROCESSING,
      processingToken,
      processingStartedAt: now,
      attemptCount: { increment: 1 },
    },
  })
  if (claimed.count !== 1) return 'skipped'

  const refund = await prisma.refund.findUniqueOrThrow({
    where: { id: refundId },
    include: {
      order: {
        select: {
          merchantId: true,
          merchant: {
            select: { razorpayAccountId: true },
          },
        },
      },
    },
  })
  type RefundOrderMerchant = {
    order?: {
      merchantId?: string
      merchant?: { razorpayAccountId?: string | null } | null
    } | null
  }
  const refundWithOrder = refund as unknown as RefundOrderMerchant
  const reverseAll = Boolean(refundWithOrder.order?.merchant?.razorpayAccountId)
  try {
    const result = await createRazorpayRefund({
      paymentId: refund.razorpayPaymentId,
      amount: refund.amount,
      refundId: refund.id,
      reverseAll,
    })
    await prisma.$transaction(async (tx) => {
      const settled = await tx.refund.updateMany({
        where: { id: refund.id, status: RefundStatus.PROCESSING, processingToken },
        data: {
          status: RefundStatus.REFUNDED,
          providerRefundId: result.providerRefundId,
          processingToken: null,
          processingStartedAt: null,
          lastError: null,
        },
      })
      if (settled.count !== 1) return
      const orderMerchantId =
        refundWithOrder.order?.merchantId ||
        (await tx.order.findUniqueOrThrow({ where: { id: refund.orderId }, select: { merchantId: true } })).merchantId
      await tx.auditLog.create({
        data: {
          merchantId: orderMerchantId,
          orderId: refund.orderId,
          action: 'REFUND_COMPLETED',
          status: 'EXECUTED',
          reason: 'Razorpay confirmed the inventory-failure refund.',
          details: { refundId: refund.id, providerRefundId: result.providerRefundId, razorpayPaymentId: refund.razorpayPaymentId, reverseAllApplied: reverseAll },
        },
      })
    })
  } catch (error) {
    const lastError = safeError(error)
    const isExhausted = refund.attemptCount >= MAX_REFUND_ATTEMPTS

    await prisma.$transaction(async (tx) => {
      if (isExhausted) {
        // Move to Dead-Letter Queue (DLQ) state: 24h quarantine so worker is not blocked
        const failed = await tx.refund.updateMany({
          where: { id: refund.id, status: RefundStatus.PROCESSING, processingToken },
          data: {
            status: RefundStatus.PENDING,
            processingToken: null,
            processingStartedAt: null,
            nextAttemptAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
            lastError,
          },
        })
        if (failed.count !== 1) return

        await tx.auditLog.create({
          data: {
            orderId: refund.orderId,
            action: 'REFUND_MOVED_TO_DEAD_LETTER_QUEUE',
            status: 'FAILED',
            reason: `Refund attempt threshold reached (${refund.attemptCount}/${MAX_REFUND_ATTEMPTS}). Quarantined for manual operator resolution.`,
            details: { refundId: refund.id, razorpayPaymentId: refund.razorpayPaymentId, lastError, attemptCount: refund.attemptCount },
          },
        })
      } else {
        const rescheduled = await tx.refund.updateMany({
          where: { id: refund.id, status: RefundStatus.PROCESSING, processingToken },
          data: {
            status: RefundStatus.PENDING,
            processingToken: null,
            processingStartedAt: null,
            nextAttemptAt: nextRetry(refund.attemptCount),
            lastError,
          },
        })
        if (rescheduled.count !== 1) return

        await tx.auditLog.create({
          data: {
            orderId: refund.orderId,
            action: 'REFUND_RETRY_SCHEDULED',
            status: 'PENDING',
            reason: 'Razorpay refund attempt failed; retry is scheduled with the same idempotency key.',
            details: { refundId: refund.id, razorpayPaymentId: refund.razorpayPaymentId, lastError, attemptCount: refund.attemptCount },
          },
        })
      }
    })

    if (isExhausted) {
      // Non-blocking critical operator alerting
      dispatchOperatorAlert([
        {
          queue: 'REFUND',
          count: 1,
          oldestAgeMinutes: Math.floor((now.getTime() - refund.createdAt.getTime()) / 60000),
          severity: 'CRITICAL',
          message: `Refund ${refund.id} for order ${refund.orderId} failed after ${refund.attemptCount} attempts. Last error: ${lastError}`,
        },
      ]).catch(() => {})

      // Keep the customer informed to prevent support tickets and anxiety
      notifyCustomerOfDLQ({
        refundId: refund.id,
        orderId: refund.orderId,
      }).catch((err) => {
        console.error('[CUSTOMER_NOTIFIER] Failed to notify customer:', err)
      })
    }
  }
  return 'attempted'
}
