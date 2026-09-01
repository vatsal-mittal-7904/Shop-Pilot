import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  updateMany: vi.fn(),
  findUniqueOrThrow: vi.fn(),
  transaction: vi.fn(),
  txUpdateMany: vi.fn(),
  txAuditCreate: vi.fn(),
  fetchPayments: vi.fn(),
  processTrusted: vi.fn(),
}))

vi.mock('@/backend/db/prisma', () => ({
  prisma: {
    paymentReconciliation: {
      findMany: mocks.findMany,
      updateMany: mocks.updateMany,
      findUniqueOrThrow: mocks.findUniqueOrThrow,
    },
    $transaction: mocks.transaction,
  },
}))
vi.mock('@/backend/services/razorpay', () => ({ razorpay: { orders: { fetchPayments: mocks.fetchPayments } } }))
vi.mock('@/backend/actions/webhookProcessor', () => ({ processTrustedRazorpayReconciliation: mocks.processTrusted }))

import { processPendingPaymentReconciliations } from '@/backend/actions/paymentReconciliation'

const task = {
  id: '2c3b83cc-0e3b-44f7-a491-d765b3cbb55b',
  attemptCount: 1,
  order: { id: 'a42075a7-9c72-4af5-86fc-2a9d8dc53576', merchantId: 'merchant-1', razorpayOrderId: 'order_test_123' },
}

describe('payment reconciliation worker', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.findMany.mockResolvedValue([{ id: task.id }])
    mocks.updateMany.mockResolvedValue({ count: 1 })
    mocks.findUniqueOrThrow.mockResolvedValue(task)
    mocks.processTrusted.mockResolvedValue({})
    const tx = { paymentReconciliation: { updateMany: mocks.txUpdateMany }, auditLog: { create: mocks.txAuditCreate } }
    mocks.transaction.mockImplementation(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx))
    mocks.txUpdateMany.mockResolvedValue({ count: 1 })
    mocks.txAuditCreate.mockResolvedValue({})
  })

  test('claims the durable row before provider lookup, applies a captured payment, and resolves it', async () => {
    mocks.fetchPayments.mockResolvedValue({
      items: [{ id: 'pay_captured_123', order_id: task.order.razorpayOrderId, amount: 125000, currency: 'INR', status: 'captured' }],
    })

    await expect(processPendingPaymentReconciliations()).resolves.toEqual({ attempted: 0, skipped: 0, resolved: 1 })

    expect(mocks.updateMany).toHaveBeenCalledBefore(mocks.fetchPayments)
    expect(mocks.processTrusted).toHaveBeenCalledWith({
      id: 'pay_captured_123', orderId: 'order_test_123', amount: 125000, currency: 'INR', status: 'captured', errorDescription: null,
    })
    expect(mocks.txUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'RESOLVED', lastError: null }),
    }))
    expect(mocks.txAuditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'PAYMENT_RECONCILED' }),
    }))
  })

  test('backs off after an unavailable provider outcome instead of trusting the browser or dropping the task', async () => {
    mocks.fetchPayments.mockResolvedValue({ items: [{ id: 'pay_pending', order_id: task.order.razorpayOrderId, amount: 125000, currency: 'INR', status: 'authorized' }] })

    await expect(processPendingPaymentReconciliations()).resolves.toEqual({ attempted: 1, skipped: 0, resolved: 0 })

    expect(mocks.processTrusted).not.toHaveBeenCalled()
    expect(mocks.txUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'PENDING', lastError: 'Razorpay has not reported a final payment outcome yet' }),
    }))
    const retry = mocks.txUpdateMany.mock.calls[0][0].data.nextAttemptAt as Date
    expect(retry.getTime()).toBeGreaterThan(Date.now() + 60_000)
    expect(mocks.txAuditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'PAYMENT_RECONCILIATION_RETRY_SCHEDULED' }),
    }))
  })
})
