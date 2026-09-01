import { processPendingPaymentReconciliations } from '@/backend/actions/paymentReconciliation'
import { processPendingRefunds } from '@/backend/actions/refundProcessor'
import { expireStaleOrders } from '@/backend/actions/orderExpiry'
import { markAbandonedCarts } from '@/backend/actions/cartSweeper'

export type OpportunisticReconciliationOptions = {
  merchantId?: string
  maxReconciliations?: number
  maxRefunds?: number
  sweepCarts?: boolean
}

export type OpportunisticReconciliationResult = {
  triggered: boolean
  paymentReconciliations: number
  refundsProcessed: number
  ordersExpired: number
  cartsAbandoned: number
  errors: string[]
}

/**
 * Multi-Tiered Self-Healing Reconciliation Engine:
 * Executes opportunistic background healing runs on:
 * 1. Scheduled HTTP Cron (/api/cron/sweep-carts)
 * 2. Merchant Dashboard loads (Tier 2 self-healing)
 * 3. Checkout retries & payment inquiries (Tier 3 self-healing)
 *
 * Runs fail-safe without throwing errors to ensure customer and merchant requests
 * are never interrupted by background healing tasks.
 */
export async function triggerOpportunisticReconciliation(
  options: OpportunisticReconciliationOptions = {}
): Promise<OpportunisticReconciliationResult> {
  const {
    merchantId,
    maxReconciliations = 5,
    maxRefunds = 5,
    sweepCarts = false,
  } = options

  const errors: string[] = []
  let paymentReconciliations = 0
  let refundsProcessed = 0
  let ordersExpired = 0
  let cartsAbandoned = 0

  const tasks: Promise<unknown>[] = []

  // 1. Payment Reconciliations
  tasks.push(
    processPendingPaymentReconciliations(maxReconciliations)
      .then((res) => {
        paymentReconciliations = res.attempted
      })
      .catch((err) => {
        errors.push(`PaymentReconciliation error: ${err instanceof Error ? err.message : String(err)}`)
      })
  )

  // 2. Pending Refunds Outbox
  tasks.push(
    processPendingRefunds(maxRefunds)
      .then((res) => {
        refundsProcessed = res.attempted
      })
      .catch((err) => {
        errors.push(`RefundProcessor error: ${err instanceof Error ? err.message : String(err)}`)
      })
  )

  // 3. Stale Unpaid Orders Expiry
  tasks.push(
    expireStaleOrders()
      .then((res) => {
        ordersExpired = res.expiredCount
      })
      .catch((err) => {
        errors.push(`OrderExpiry error: ${err instanceof Error ? err.message : String(err)}`)
      })
  )

  // 4. Cart Inactivity Sweep (Optional, when merchantId is provided)
  if (merchantId && sweepCarts) {
    tasks.push(
      markAbandonedCarts(merchantId)
        .then((res) => {
          cartsAbandoned = res.updatedCount
        })
        .catch((err) => {
          errors.push(`CartSweeper error: ${err instanceof Error ? err.message : String(err)}`)
        })
    )
  }

  await Promise.allSettled(tasks)

  if (errors.length > 0) {
    console.error('[OPPORTUNISTIC_RECONCILIATION:WARNING]', errors)
  }

  return {
    triggered: true,
    paymentReconciliations,
    refundsProcessed,
    ordersExpired,
    cartsAbandoned,
    errors,
  }
}
