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

const refund = {
  id: '1b3c83cc-0e3b-44f7-a491-d765b3cbb55b',
  orderId: 'a42075a7-9c72-4af5-86fc-2a9d8dc53576',
  razorpayPaymentId: 'pay_test_refund_123',
  amount: 125000,
  currency: 'INR',
  status: 'PROCESSING',
  attemptCount: 1,
}

describe('refund outbox', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    process.env.RAZORPAY_KEY_ID = 'rzp_test_key'
    process.env.RAZORPAY_KEY_SECRET = 'test_secret'
    mocks.findMany.mockResolvedValue([{ id: refund.id }])
    mocks.updateMany.mockResolvedValue({ count: 1 })
    mocks.findUniqueOrThrow.mockResolvedValue(refund)
    const tx = {
      refund: { updateMany: mocks.txUpdateMany },
      order: { findUniqueOrThrow: mocks.txOrderFindUniqueOrThrow },
      auditLog: { create: mocks.txAuditCreate },
    }
    mocks.transaction.mockImplementation(async (fn: (value: typeof tx) => Promise<unknown>) => fn(tx))
    mocks.txUpdateMany.mockResolvedValue({ count: 1 })
    mocks.txOrderFindUniqueOrThrow.mockResolvedValue({ merchantId: 'merchant-1' })
    mocks.txAuditCreate.mockResolvedValue({})
  })

  test('calls Razorpay only after claiming a durable refund row and settles it with the stable idempotency key', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'rfnd_provider_123' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(processPendingRefunds()).resolves.toEqual({ attempted: 1, skipped: 0 })

    expect(mocks.updateMany).toHaveBeenCalledBefore(fetchMock)
    expect(fetchMock).toHaveBeenCalledWith(
      `https://api.razorpay.com/v1/payments/${refund.razorpayPaymentId}/refund`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'X-Refund-Idempotency': refund.id }),
        body: JSON.stringify({
          amount: refund.amount,
          receipt: `mso_refund_${refund.id}`,
          notes: { reason: 'inventory_unavailable', internalRefundId: refund.id },
        }),
      }),
    )
    expect(mocks.txUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'REFUNDED', providerRefundId: 'rfnd_provider_123' }),
    }))
    expect(mocks.txAuditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'REFUND_COMPLETED' }),
    }))
  })

  test('leaves a failed provider call queued for a retry with the same durable idempotency key', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ error: { description: 'Temporary provider outage' } }),
    }))

    await expect(processPendingRefunds()).resolves.toEqual({ attempted: 1, skipped: 0 })

    expect(mocks.txUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'PENDING', lastError: 'Temporary provider outage' }),
    }))
    expect(mocks.txAuditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'REFUND_RETRY_SCHEDULED' }),
    }))
  })
})
