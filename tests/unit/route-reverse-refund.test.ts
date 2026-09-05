import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  updateMany: vi.fn(),
  findUniqueOrThrow: vi.fn(),
  transaction: vi.fn(),
  txUpdateMany: vi.fn(),
  txOrderFindUniqueOrThrow: vi.fn(),
  txAuditCreate: vi.fn(),
}))

vi.mock('@/backend/db/prisma', () => ({
  prisma: {
    refund: {
      findMany: mocks.findMany,
      updateMany: mocks.updateMany,
      findUniqueOrThrow: mocks.findUniqueOrThrow,
    },
    $transaction: mocks.transaction,
  },
}))

import { processPendingRefunds } from '@/backend/actions/refundProcessor'

const refundWithRoute = {
  id: 'refund-route-uuid-1234',
  orderId: 'order-route-uuid-5678',
  razorpayPaymentId: 'pay_test_route_refund_999',
  amount: 250000,
  currency: 'INR',
  status: 'PROCESSING',
  attemptCount: 1,
  order: {
    merchantId: 'merchant-route-1',
    merchant: {
      razorpayAccountId: 'acc_route_subaccount_xyz',
    },
  },
}

const refundWithoutRoute = {
  id: 'refund-standard-uuid-1111',
  orderId: 'order-standard-uuid-2222',
  razorpayPaymentId: 'pay_test_standard_refund_888',
  amount: 150000,
  currency: 'INR',
  status: 'PROCESSING',
  attemptCount: 1,
  order: {
    merchantId: 'merchant-standard-1',
    merchant: {
      razorpayAccountId: null,
    },
  },
}

describe('Razorpay Route settlement reversal in refund outbox', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    process.env.RAZORPAY_KEY_ID = 'rzp_test_key'
    process.env.RAZORPAY_KEY_SECRET = 'test_secret'
    mocks.findMany.mockResolvedValue([{ id: refundWithRoute.id }])
    mocks.updateMany.mockResolvedValue({ count: 1 })
    const tx = {
      refund: { updateMany: mocks.txUpdateMany },
      order: { findUniqueOrThrow: mocks.txOrderFindUniqueOrThrow },
      auditLog: { create: mocks.txAuditCreate },
    }
    mocks.transaction.mockImplementation(async (fn: (value: typeof tx) => Promise<unknown>) => fn(tx))
    mocks.txUpdateMany.mockResolvedValue({ count: 1 })
    mocks.txOrderFindUniqueOrThrow.mockResolvedValue({ merchantId: 'merchant-route-1' })
    mocks.txAuditCreate.mockResolvedValue({})
  })

  test('passes reverse_all: 1 when the merchant has a linked Route subaccount', async () => {
    mocks.findUniqueOrThrow.mockResolvedValue(refundWithRoute)
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'rfnd_route_provider_123' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(processPendingRefunds()).resolves.toEqual({ attempted: 1, skipped: 0 })

    expect(fetchMock).toHaveBeenCalledWith(
      `https://api.razorpay.com/v1/payments/${refundWithRoute.razorpayPaymentId}/refund`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'X-Refund-Idempotency': refundWithRoute.id }),
        body: JSON.stringify({
          amount: refundWithRoute.amount,
          receipt: `mso_refund_${refundWithRoute.id}`,
          notes: { reason: 'inventory_unavailable', internalRefundId: refundWithRoute.id },
          reverse_all: 1,
        }),
      }),
    )

    expect(mocks.txAuditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: 'REFUND_COMPLETED',
        details: expect.objectContaining({ reverseAllApplied: true }),
      }),
    }))
  })

  test('omits reverse_all when the merchant has no linked Route subaccount', async () => {
    mocks.findMany.mockResolvedValue([{ id: refundWithoutRoute.id }])
    mocks.findUniqueOrThrow.mockResolvedValue(refundWithoutRoute)
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'rfnd_std_provider_456' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(processPendingRefunds()).resolves.toEqual({ attempted: 1, skipped: 0 })

    expect(fetchMock).toHaveBeenCalledWith(
      `https://api.razorpay.com/v1/payments/${refundWithoutRoute.razorpayPaymentId}/refund`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          amount: refundWithoutRoute.amount,
          receipt: `mso_refund_${refundWithoutRoute.id}`,
          notes: { reason: 'inventory_unavailable', internalRefundId: refundWithoutRoute.id },
        }),
      }),
    )

    expect(mocks.txAuditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: 'REFUND_COMPLETED',
        details: expect.objectContaining({ reverseAllApplied: false }),
      }),
    }))
  })
})
