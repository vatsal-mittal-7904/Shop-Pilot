/**
 * Production Background Scheduler Daemon & Reconciliation Worker
 *
 * Runs continuous asynchronous background jobs for:
 * 1. Razorpay Payment Reconciliation (PaymentReconciliation queue)
 * 2. Refund Outbox Processing (Refund queue)
 * 3. Stale Unpaid Order Expiry & Intent Budget Release (OrderExpiry)
 * 4. Inactive Cart Abandonment Sweeps across all active merchants (CartSweeper)
 *
 * Usage:
 *   Continuous daemon mode: npm run daemon
 *   Single-pass cron mode:   npm run daemon:once
 */

import { prisma } from '@/backend/db/prisma'
import { processPendingPaymentReconciliations } from '@/backend/actions/paymentReconciliation'
import { processPendingRefunds } from '@/backend/actions/refundProcessor'
import { expireStaleOrders } from '@/backend/actions/orderExpiry'
import { markAbandonedCarts } from '@/backend/actions/cartSweeper'
import { checkQueueHealth } from '@/backend/actions/queueMonitor'

const DEFAULT_INTERVAL_MS = 15_000

export type DaemonCycleSummary = {
  cycle: number
  timestamp: string
  paymentReconciliations: number
  refundsProcessed: number
  ordersExpired: number
  cartsAbandoned: number
  activeMerchantsSwept: number
  queueHealth: {
    pendingReconciliations: number
    pendingRefunds: number
    staleProcessingTokens: number
  }
  errors: string[]
}

export async function runDaemonCycle(cycleNumber = 1): Promise<DaemonCycleSummary> {
  const timestamp = new Date().toISOString()
  const errors: string[] = []

  let paymentReconciliations = 0
  let refundsProcessed = 0
  let ordersExpired = 0
  let cartsAbandoned = 0
  let activeMerchantsSwept = 0

  // 1. Payment Reconciliations
  try {
    const res = await processPendingPaymentReconciliations(10)
    paymentReconciliations = res.attempted
  } catch (err) {
    errors.push(`PaymentReconciliation error: ${err instanceof Error ? err.message : String(err)}`)
  }

  // 2. Pending Refunds Outbox
  try {
    const res = await processPendingRefunds(10)
    refundsProcessed = res.attempted
  } catch (err) {
    errors.push(`RefundProcessor error: ${err instanceof Error ? err.message : String(err)}`)
  }

  // 3. Stale Unpaid Order Expiry
  try {
    const res = await expireStaleOrders()
    ordersExpired = res.expiredCount
  } catch (err) {
    errors.push(`OrderExpiry error: ${err instanceof Error ? err.message : String(err)}`)
  }

  // 4. Cart Abandonment Sweeps for all Merchants
  try {
    const merchants = await prisma.merchant.findMany({ select: { id: true, name: true } })
    activeMerchantsSwept = merchants.length
    for (const merchant of merchants) {
      try {
        const sweepRes = await markAbandonedCarts(merchant.id)
        cartsAbandoned += sweepRes.updatedCount
      } catch (sweepErr) {
        errors.push(`CartSweeper error for merchant ${merchant.id}: ${sweepErr instanceof Error ? sweepErr.message : String(sweepErr)}`)
      }
    }
  } catch (err) {
    errors.push(`Merchant lookup error: ${err instanceof Error ? err.message : String(err)}`)
  }

  // 5. Queue Health Telemetry
  let queueHealth = {
    pendingReconciliations: 0,
    pendingRefunds: 0,
    staleProcessingTokens: 0,
  }
  try {
    const health = await checkQueueHealth()
    queueHealth = {
      pendingReconciliations: health.paymentReconciliations.pendingCount,
      pendingRefunds: health.refunds.pendingCount,
      staleProcessingTokens: health.paymentReconciliations.highAttemptCount + health.refunds.highAttemptCount,
    }
  } catch (err) {
    errors.push(`Queue health error: ${err instanceof Error ? err.message : String(err)}`)
  }

  return {
    cycle: cycleNumber,
    timestamp,
    paymentReconciliations,
    refundsProcessed,
    ordersExpired,
    cartsAbandoned,
    activeMerchantsSwept,
    queueHealth,
    errors,
  }
}

async function main() {
  const args = process.argv.slice(2)
  const isOnce = args.includes('--once')
  const intervalArg = args.find((a) => a.startsWith('--interval='))
  const intervalMs = intervalArg
    ? parseInt(intervalArg.split('=')[1], 10)
    : parseInt(process.env.DAEMON_INTERVAL_MS || String(DEFAULT_INTERVAL_MS), 10)

  console.log('================================================================================')
  console.log(' ⚙️  Shop-Pilot Background Scheduler Daemon')
  console.log('================================================================================')
  console.log(` Mode: ${isOnce ? 'Single-Pass Run (--once)' : `Continuous Daemon (Interval: ${intervalMs}ms)`}`)
  console.log(` Process PID: ${process.pid}\n`)

  let isRunning = true
  let cycle = 1

  const shutdown = async (signal: string) => {
    console.log(`\n[DAEMON] Received ${signal}. Gracefully stopping background worker...`)
    isRunning = false
    try {
      await prisma.$disconnect()
    } catch {
      // ignore
    }
    process.exit(0)
  }

  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))

  if (isOnce) {
    console.log(`[DAEMON] Executing maintenance cycle #1...`)
    const summary = await runDaemonCycle(1)
    console.log(`[DAEMON:RESULT] Cycle #1 finished at ${summary.timestamp}:`)
    console.log(`  • Payment Reconciliations Attempted: ${summary.paymentReconciliations}`)
    console.log(`  • Refund Outbox Dispatches Attempted: ${summary.refundsProcessed}`)
    console.log(`  • Stale Orders Expired: ${summary.ordersExpired}`)
    console.log(`  • Inactive Carts Marked Abandoned: ${summary.cartsAbandoned} across ${summary.activeMerchantsSwept} merchant(s)`)
    console.log(`  • Backlog: ${summary.queueHealth.pendingReconciliations} pending reconciliations, ${summary.queueHealth.pendingRefunds} pending refunds`)
    if (summary.errors.length > 0) {
      console.warn(`  ⚠ Encountered ${summary.errors.length} non-fatal warning(s):`, summary.errors)
    }
    console.log('\n✔ Single-pass maintenance run complete.')
    await prisma.$disconnect()
    return
  }

  while (isRunning) {
    const startTime = Date.now()
    try {
      const summary = await runDaemonCycle(cycle)
      const durationMs = Date.now() - startTime
      console.log(
        `[DAEMON:TICK] Cycle #${cycle} completed in ${durationMs}ms | ` +
        `Reconciled: ${summary.paymentReconciliations} | Refunds: ${summary.refundsProcessed} | ` +
        `Expired: ${summary.ordersExpired} | Abandoned Carts: ${summary.cartsAbandoned} | ` +
        `Pending: ${summary.queueHealth.pendingReconciliations}rec/${summary.queueHealth.pendingRefunds}ref`
      )
      if (summary.errors.length > 0) {
        console.warn(`[DAEMON:WARN]`, summary.errors)
      }
    } catch (cycleErr) {
      console.error(`[DAEMON:ERROR] Unhandled cycle exception:`, cycleErr)
    }

    cycle++
    if (isRunning) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs))
    }
  }
}

if (process.env.NODE_ENV !== 'test' && require.main === module) {
  main().catch((err) => {
    console.error('[DAEMON:FATAL]', err)
    process.exit(1)
  })
}
