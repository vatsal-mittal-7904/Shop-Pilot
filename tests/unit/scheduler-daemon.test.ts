import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  processPendingPaymentReconciliations: vi.fn(),
  processPendingRefunds: vi.fn(),
  expireStaleOrders: vi.fn(),
  markAbandonedCarts: vi.fn(),
  checkQueueHealth: vi.fn(),
  merchantFindMany: vi.fn(),
}))

vi.mock('@/backend/actions/paymentReconciliation', () => ({
  processPendingPaymentReconciliations: mocks.processPendingPaymentReconciliations,
}))

vi.mock('@/backend/actions/refundProcessor', () => ({
  processPendingRefunds: mocks.processPendingRefunds,
}))

vi.mock('@/backend/actions/orderExpiry', () => ({
  expireStaleOrders: mocks.expireStaleOrders,
}))

vi.mock('@/backend/actions/cartSweeper', () => ({
  markAbandonedCarts: mocks.markAbandonedCarts,
}))

vi.mock('@/backend/actions/queueMonitor', () => ({
  checkQueueHealth: mocks.checkQueueHealth,
}))

vi.mock('@/backend/db/prisma', () => ({
  prisma: {
    merchant: {
      findMany: mocks.merchantFindMany,
    },
    $disconnect: vi.fn(),
  },
}))

import { runDaemonCycle } from '@/../scripts/scheduler-daemon'

describe('Production Background Scheduler Daemon', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.processPendingPaymentReconciliations.mockResolvedValue({ attempted: 4 })
    mocks.processPendingRefunds.mockResolvedValue({ attempted: 2 })
    mocks.expireStaleOrders.mockResolvedValue({ expiredCount: 3 })
    mocks.merchantFindMany.mockResolvedValue([
      { id: 'm1', name: 'Merchant 1' },
      { id: 'm2', name: 'Merchant 2' },
    ])
    mocks.markAbandonedCarts.mockResolvedValue({ updatedCount: 1 })
    mocks.checkQueueHealth.mockResolvedValue({
      paymentReconciliations: { pendingCount: 0, oldestAgeMinutes: null, highAttemptCount: 0 },
      refunds: { pendingCount: 0, oldestAgeMinutes: null, highAttemptCount: 0 },
    })
  })

  test('executes a complete multi-job maintenance cycle and aggregates metrics', async () => {
    const summary = await runDaemonCycle(1)

    expect(summary.cycle).toBe(1)
    expect(summary.paymentReconciliations).toBe(4)
    expect(summary.refundsProcessed).toBe(2)
    expect(summary.ordersExpired).toBe(3)
    expect(summary.activeMerchantsSwept).toBe(2)
    expect(summary.cartsAbandoned).toBe(2) // 1 per merchant * 2 merchants
    expect(summary.errors).toHaveLength(0)

    expect(mocks.processPendingPaymentReconciliations).toHaveBeenCalledWith(10)
    expect(mocks.processPendingRefunds).toHaveBeenCalledWith(10)
    expect(mocks.expireStaleOrders).toHaveBeenCalled()
    expect(mocks.markAbandonedCarts).toHaveBeenCalledTimes(2)
    expect(mocks.checkQueueHealth).toHaveBeenCalled()
  })

  test('isolates failures in individual background workers without aborting the cycle', async () => {
    mocks.processPendingPaymentReconciliations.mockRejectedValue(new Error('Razorpay API timeout'))
    mocks.processPendingRefunds.mockResolvedValue({ attempted: 1 })

    const summary = await runDaemonCycle(2)

    expect(summary.cycle).toBe(2)
    expect(summary.paymentReconciliations).toBe(0)
    expect(summary.refundsProcessed).toBe(1)
    expect(summary.errors).toHaveLength(1)
    expect(summary.errors[0]).toContain('Razorpay API timeout')
  })
})
