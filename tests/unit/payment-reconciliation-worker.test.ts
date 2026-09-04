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

  test('preferentially selects captured payment over prior failed attempt when both webhooks were lost', async () => {
    // Attempt 1 failed, Attempt 2 captured. Failed entry is FIRST in items array.
    mocks.fetchPayments.mockResolvedValue({
      items: [
        { id: 'pay_failed_old', order_id: task.order.razorpayOrderId, amount: 125000, currency: 'INR', status: 'failed', error_description: 'Card declined' },
        { id: 'pay_captured_new', order_id: task.order.razorpayOrderId, amount: 125000, currency: 'INR', status: 'captured' },
      ],
    })

    await expect(processPendingPaymentReconciliations()).resolves.toEqual({ attempted: 0, skipped: 0, resolved: 1 })

    // MUST apply the captured payment, NOT the failed payment
    expect(mocks.processTrusted).toHaveBeenCalledWith(expect.objectContaining({
      id: 'pay_captured_new',
      status: 'captured',
    }))
    expect(mocks.txUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'RESOLVED' }),
    }))
  })

  test('preferentially selects captured payment even if a subsequent attempt is recorded as failed', async () => {
    // Attempt 1 captured, Attempt 2 recorded as failed
    mocks.fetchPayments.mockResolvedValue({
      items: [
        { id: 'pay_captured_first', order_id: task.order.razorpayOrderId, amount: 125000, currency: 'INR', status: 'captured' },
        { id: 'pay_failed_second', order_id: task.order.razorpayOrderId, amount: 125000, currency: 'INR', status: 'failed' },
      ],
    })

    await expect(processPendingPaymentReconciliations()).resolves.toEqual({ attempted: 0, skipped: 0, resolved: 1 })

    expect(mocks.processTrusted).toHaveBeenCalledWith(expect.objectContaining({
      id: 'pay_captured_first',
      status: 'captured',
    }))
  })

  test('reschedules retry when all recorded attempts failed but checkout retry window is active', async () => {
    // Fresh order created 2 minutes ago, attemptCount 1
    const freshTask = {
      ...task,
      attemptCount: 1,
      order: {
        ...task.order,
        status: 'PAYMENT_PENDING',
        createdAt: new Date(Date.now() - 2 * 60 * 1000),
      },
    }
    mocks.findUniqueOrThrow.mockResolvedValue(freshTask)
    mocks.fetchPayments.mockResolvedValue({
      items: [
        { id: 'pay_failed_temp', order_id: task.order.razorpayOrderId, amount: 125000, currency: 'INR', status: 'failed' },
      ],
    })

    await expect(processPendingPaymentReconciliations()).resolves.toEqual({ attempted: 1, skipped: 0, resolved: 0 })

    // Must NOT immediately settle order as failed while shopper may be retrying
    expect(mocks.processTrusted).not.toHaveBeenCalled()
    expect(mocks.txUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: 'PENDING',
        lastError: expect.stringMatching(/checkout retry window is active/),
      }),
    }))
  })

  test('resolves as failed when all recorded attempts failed and checkout retry window has expired', async () => {
    // Stale order created 30 minutes ago, attemptCount 4
    const staleTask = {
      ...task,
      attemptCount: 4,
      order: {
        ...task.order,
        status: 'PAYMENT_PENDING',
        createdAt: new Date(Date.now() - 30 * 60 * 1000),
      },
    }
    mocks.findUniqueOrThrow.mockResolvedValue(staleTask)
    mocks.fetchPayments.mockResolvedValue({
      items: [
        { id: 'pay_failed_final', order_id: task.order.razorpayOrderId, amount: 125000, currency: 'INR', status: 'failed', error_description: 'Payment expired' },
      ],
    })

    await expect(processPendingPaymentReconciliations()).resolves.toEqual({ attempted: 0, skipped: 0, resolved: 1 })

    // Now it authoritatively applies the failed payment
    expect(mocks.processTrusted).toHaveBeenCalledWith(expect.objectContaining({
      id: 'pay_failed_final',
      status: 'failed',
    }))
  })
})
