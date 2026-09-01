import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  orderFindMany: vi.fn(),
  orderUpdateMany: vi.fn(),
  paymentUpdateMany: vi.fn(),
  offerUpdateMany: vi.fn(),
  auditLogCreate: vi.fn(),
  transaction: vi.fn(),
  fetchPayments: vi.fn(),
  executeRaw: vi.fn(),
}))

vi.mock('@/backend/db/prisma', () => ({
  prisma: {
    order: {
      findMany: mocks.orderFindMany,
      updateMany: mocks.orderUpdateMany,
    },
    payment: {
      updateMany: mocks.paymentUpdateMany,
    },
    offer: {
      updateMany: mocks.offerUpdateMany,
    },
    auditLog: {
      create: mocks.auditLogCreate,
    },
    $transaction: mocks.transaction,
  },
}))

vi.mock('@/backend/services/razorpay', () => ({
  razorpay: {
    orders: {
      fetchPayments: mocks.fetchPayments,
    },
  },
}))

import { expireStaleOrders, getProviderPaymentStatus } from '@/backend/actions/orderExpiry'
import { assertAccountSpendLimit } from '@/backend/actions/accountBudget'

const CUSTOMER_ID = '11111111-1111-4111-8111-111111111111'
const MERCHANT_ID = '22222222-2222-4222-8222-222222222222'
const ORDER_ID = '33333333-3333-4333-8333-333333333333'
const OFFER_ID = '44444444-4444-4444-8444-444444444444'

describe('Stale Unpaid Order Expiry & Money Safety Invariants', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.transaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        order: { updateMany: mocks.orderUpdateMany },
        payment: { updateMany: mocks.paymentUpdateMany },
        offer: { updateMany: mocks.offerUpdateMany },
        auditLog: { create: mocks.auditLogCreate },
      }
      return cb(tx)
    })
    mocks.orderUpdateMany.mockResolvedValue({ count: 1 })
    mocks.paymentUpdateMany.mockResolvedValue({ count: 1 })
    mocks.offerUpdateMany.mockResolvedValue({ count: 1 })
    mocks.auditLogCreate.mockResolvedValue({})
  })

  describe('expireStaleOrders()', () => {
    test('authoritatively expires stale unpaid orders when Razorpay confirms no capture', async () => {
      const staleDate = new Date(Date.now() - 40 * 60 * 1000)
      mocks.orderFindMany.mockResolvedValue([
        {
          id: ORDER_ID,
          merchantId: MERCHANT_ID,
          customerId: CUSTOMER_ID,
          totalAmount: 50_000,
          status: 'PAYMENT_PENDING',
          razorpayOrderId: 'order_rzp_123',
          offerId: OFFER_ID,
          createdAt: staleDate,
          offer: { id: OFFER_ID, status: 'ACCEPTED', expiresAt: new Date(Date.now() - 10 * 60 * 1000) },
        },
      ])

      // Razorpay confirms no captured payment
      mocks.fetchPayments.mockResolvedValue({ items: [] })

      const result = await expireStaleOrders()

      expect(result.expiredCount).toBe(1)
      expect(result.expiredOrderIds).toEqual([ORDER_ID])

      expect(mocks.orderUpdateMany).toHaveBeenCalledWith({
        where: { id: ORDER_ID, status: 'PAYMENT_PENDING' },
        data: { status: 'EXPIRED' },
      })
      expect(mocks.paymentUpdateMany).toHaveBeenCalledWith({
        where: { orderId: ORDER_ID, status: 'PENDING' },
        data: { status: 'FAILED' },
      })
      expect(mocks.offerUpdateMany).toHaveBeenCalledWith({
        where: { id: OFFER_ID, status: { in: ['ACTIVE', 'ACCEPTED'] } },
        data: { status: 'EXPIRED' },
      })
      expect(mocks.auditLogCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          merchantId: MERCHANT_ID,
          orderId: ORDER_ID,
          action: 'ORDER_EXPIRED',
          status: 'EXECUTED',
          details: expect.objectContaining({ orderId: ORDER_ID, customerId: CUSTOMER_ID, totalAmount: 50_000 }),
        }),
      })
    })

    test('fail-closed: retains PAYMENT_PENDING when Razorpay API call fails with network/server error', async () => {
      const staleDate = new Date(Date.now() - 40 * 60 * 1000)
      mocks.orderFindMany.mockResolvedValue([
        {
          id: ORDER_ID,
          merchantId: MERCHANT_ID,
          customerId: CUSTOMER_ID,
          totalAmount: 50_000,
          status: 'PAYMENT_PENDING',
          razorpayOrderId: 'order_rzp_err',
          offerId: OFFER_ID,
          createdAt: staleDate,
          offer: { id: OFFER_ID, status: 'ACCEPTED', expiresAt: new Date(Date.now() - 10 * 60 * 1000) },
        },
      ])

      // Razorpay API throws a network timeout or 500 error
      mocks.fetchPayments.mockRejectedValue(new Error('Razorpay API timeout'))

      const result = await expireStaleOrders()

      // Money invariant: must NOT expire order on provider error
      expect(result.expiredCount).toBe(0)
      expect(result.skippedErrorCount).toBe(1)
      expect(mocks.orderUpdateMany).not.toHaveBeenCalled()
      expect(mocks.auditLogCreate).not.toHaveBeenCalled()
    })

    test('retains PAYMENT_PENDING when Razorpay confirms payment was captured', async () => {
      const staleDate = new Date(Date.now() - 40 * 60 * 1000)
      mocks.orderFindMany.mockResolvedValue([
        {
          id: ORDER_ID,
          merchantId: MERCHANT_ID,
          customerId: CUSTOMER_ID,
          totalAmount: 50_000,
          status: 'PAYMENT_PENDING',
          razorpayOrderId: 'order_rzp_captured',
          offerId: OFFER_ID,
          createdAt: staleDate,
          offer: { id: OFFER_ID, status: 'ACCEPTED', expiresAt: new Date(Date.now() - 10 * 60 * 1000) },
        },
      ])

      // Razorpay confirms payment was captured
      mocks.fetchPayments.mockResolvedValue({
        items: [{ id: 'pay_123', status: 'captured', amount: 50_000 }],
      })

      const result = await expireStaleOrders()

      expect(result.expiredCount).toBe(0)
      expect(result.capturedPendingCount).toBe(1)
      expect(mocks.orderUpdateMany).not.toHaveBeenCalled()
      expect(mocks.auditLogCreate).not.toHaveBeenCalled()
    })
  })

  describe('getProviderPaymentStatus()', () => {
    test('returns CAPTURED when payments array has captured payment', async () => {
      mocks.fetchPayments.mockResolvedValue({
        items: [{ id: 'pay_1', status: 'captured' }],
      })
      await expect(getProviderPaymentStatus('order_1')).resolves.toBe('CAPTURED')
    })

    test('returns NOT_CAPTURED when payments array has no captured payment', async () => {
      mocks.fetchPayments.mockResolvedValue({
        items: [{ id: 'pay_1', status: 'failed' }],
      })
      await expect(getProviderPaymentStatus('order_1')).resolves.toBe('NOT_CAPTURED')
    })

    test('returns PROVIDER_ERROR when fetchPayments throws', async () => {
      mocks.fetchPayments.mockRejectedValue(new Error('Connection reset'))
      await expect(getProviderPaymentStatus('order_1')).resolves.toBe('PROVIDER_ERROR')
    })
  })

  describe('assertAccountSpendLimit()', () => {
    test('excludes EXPIRED orders and allows checkout within budget', async () => {
      const tx = {
        $executeRaw: mocks.executeRaw,
        customer: { findUnique: vi.fn().mockResolvedValue({ dailySpendLimit: 100_000, monthlySpendLimit: 500_000 }) },
        order: {
          aggregate: vi.fn()
            .mockResolvedValueOnce({ _sum: { totalAmount: 20_000 } })
            .mockResolvedValueOnce({ _sum: { totalAmount: 40_000 } }),
        },
      }

      const result = await assertAccountSpendLimit(tx as never, CUSTOMER_ID, 50_000)

      expect(result).toMatchObject({
        dailyCommitted: 20_000,
        monthlyCommitted: 40_000,
        dailyLimit: 100_000,
        monthlyLimit: 500_000,
      })
    })
  })
})
