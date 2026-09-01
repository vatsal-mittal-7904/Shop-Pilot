import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireCustomer: vi.fn(),
  findFirst: vi.fn(),
  reserveReceipt: vi.fn(),
  transaction: vi.fn(),
  providerList: vi.fn(),
  providerCreate: vi.fn(),
}))

vi.mock('@/backend/auth/session', () => ({ requireCustomer: mocks.requireCustomer }))
vi.mock('@/backend/db/prisma', () => ({
  prisma: {
    order: { findFirst: mocks.findFirst, updateMany: mocks.reserveReceipt },
    auditLog: { create: vi.fn() },
    $transaction: mocks.transaction,
  },
}))
vi.mock('@/backend/services/razorpay', () => ({
  razorpay: { orders: { all: mocks.providerList, create: mocks.providerCreate } },
}))
vi.mock('@/backend/actions/order', () => ({ createOrReuseCheckoutOrder: vi.fn() }))

import { createRazorpayOrder } from '@/backend/actions/payment'

const INTERNAL_ORDER_ID = 'd560ebdc-263c-4edb-82f7-f46b12ba5b65'
const receipt = `mso_${INTERNAL_ORDER_ID}`
const baseOrder = {
  id: INTERNAL_ORDER_ID,
  merchantId: 'merchant-1',
  customerId: 'customer-1',
  totalAmount: 749900,
  currency: 'INR',
  status: 'PAYMENT_PENDING',
  razorpayOrderId: null,
  payment: { razorpayOrderId: null },
  items: [],
}

function successfulTransaction() {
  const tx = {
    order: { updateMany: vi.fn().mockResolvedValue({ count: 1 }), findUnique: vi.fn() },
    payment: { update: vi.fn() },
    paymentReconciliation: { upsert: vi.fn() },
    auditLog: { create: vi.fn() },
  }
  mocks.transaction.mockImplementation(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx))
  return tx
}

describe('Razorpay order reconciliation', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.requireCustomer.mockResolvedValue({ user: { id: 'user-1' }, customer: { id: 'customer-1' } })
    mocks.findFirst.mockResolvedValue(baseOrder)
    mocks.reserveReceipt.mockResolvedValue({ count: 1 })
  })

  test('reconciles a provider order by durable receipt instead of creating another one', async () => {
    const tx = successfulTransaction()
    mocks.providerList.mockResolvedValue({
      items: [{ id: 'order_existing', amount: 749900, currency: 'INR', receipt }],
    })

    await expect(createRazorpayOrder(INTERNAL_ORDER_ID)).resolves.toEqual({
      id: 'order_existing', amount: 749900, currency: 'INR',
    })

    expect(mocks.reserveReceipt).toHaveBeenCalledWith(expect.objectContaining({ data: { razorpayReceipt: receipt } }))
    expect(mocks.providerCreate).not.toHaveBeenCalled()
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'RAZORPAY_ORDER_RECONCILED' }),
    }))
  })

  test('recovers after the provider succeeded but the initial database persistence failed', async () => {
    const providerOrder = { id: 'order_recovered', amount: 749900, currency: 'INR', receipt }
    mocks.providerList
      .mockResolvedValueOnce({ items: [] })
      .mockResolvedValueOnce({ items: [providerOrder] })
    mocks.providerCreate.mockResolvedValue(providerOrder)

    const failingTx = {
    order: { updateMany: vi.fn().mockResolvedValue({ count: 1 }), findUnique: vi.fn() },
    payment: { update: vi.fn().mockRejectedValue(new Error('database write failed')) },
    paymentReconciliation: { upsert: vi.fn() },
    auditLog: { create: vi.fn() },
    }
    mocks.transaction.mockImplementationOnce(async (callback: (value: typeof failingTx) => Promise<unknown>) => callback(failingTx))
    await expect(createRazorpayOrder(INTERNAL_ORDER_ID)).rejects.toThrow('database write failed')

    const recoveryTx = successfulTransaction()
    await expect(createRazorpayOrder(INTERNAL_ORDER_ID)).resolves.toEqual({
      id: 'order_recovered', amount: 749900, currency: 'INR',
    })

    expect(mocks.providerCreate).toHaveBeenCalledTimes(1)
    expect(recoveryTx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'RAZORPAY_ORDER_RECONCILED' }),
    }))
  })
})
