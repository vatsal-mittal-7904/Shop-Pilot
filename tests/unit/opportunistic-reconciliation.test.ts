import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  processPendingPaymentReconciliations: vi.fn(),
  processPendingRefunds: vi.fn(),
  expireStaleOrders: vi.fn(),
  markAbandonedCarts: vi.fn(),
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

import { triggerOpportunisticReconciliation } from '@/backend/actions/opportunisticReconciliation'

describe('Multi-Tiered Opportunistic Reconciliation Engine', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.processPendingPaymentReconciliations.mockResolvedValue({ attempted: 2, skipped: 0, resolved: 2 })
    mocks.processPendingRefunds.mockResolvedValue({ attempted: 3, refunded: 3, failed: 0 })
    mocks.expireStaleOrders.mockResolvedValue({ expiredCount: 2, expiredOrderIds: ['ord-1', 'ord-2'], skippedErrorCount: 0, capturedPendingCount: 0, evaluatedCount: 2 })
    mocks.markAbandonedCarts.mockResolvedValue({ updatedCount: 1 })
  })

  it('triggers all reconciliation tiers and aggregates healed counts', async () => {
    const result = await triggerOpportunisticReconciliation({
      merchantId: 'merchant-123',
      maxReconciliations: 5,
      maxRefunds: 5,
      sweepCarts: true,
    })

    expect(result.triggered).toBe(true)
    expect(result.paymentReconciliations).toBe(2)
    expect(result.refundsProcessed).toBe(3)
    expect(result.ordersExpired).toBe(2)
    expect(result.cartsAbandoned).toBe(1)
    expect(result.errors).toHaveLength(0)

    expect(mocks.processPendingPaymentReconciliations).toHaveBeenCalledWith(5)
    expect(mocks.processPendingRefunds).toHaveBeenCalledWith(5)
    expect(mocks.expireStaleOrders).toHaveBeenCalled()
    expect(mocks.markAbandonedCarts).toHaveBeenCalledWith('merchant-123')
  })

  it('fails safely without throwing when sub-workers experience exceptions', async () => {
    mocks.processPendingPaymentReconciliations.mockRejectedValue(new Error('Network timeout during provider lookup'))
    mocks.processPendingRefunds.mockRejectedValue(new Error('Postgres lock timeout'))

    const result = await triggerOpportunisticReconciliation({
      merchantId: 'merchant-123',
      sweepCarts: false,
    })

    expect(result.triggered).toBe(true)
    expect(result.paymentReconciliations).toBe(0)
    expect(result.refundsProcessed).toBe(0)
    expect(result.ordersExpired).toBe(2)
    expect(result.errors).toHaveLength(2)
    expect(result.errors[0]).toContain('PaymentReconciliation error')
    expect(result.errors[1]).toContain('RefundProcessor error')
  })
})
