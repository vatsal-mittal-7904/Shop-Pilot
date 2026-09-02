import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  orderFindFirst: vi.fn(),
  orderUpdate: vi.fn(),
  paymentUpdate: vi.fn(),
  productUpdate: vi.fn(),
  refundCreate: vi.fn(),
  auditLogCreate: vi.fn(),
  executeRaw: vi.fn(),
  requireCustomer: vi.fn(),
  requireMerchant: vi.fn(),
  processPendingRefunds: vi.fn(),
}))

vi.mock('@/backend/auth/session', () => ({
  requireCustomer: mocks.requireCustomer,
  requireMerchant: mocks.requireMerchant,
}))

vi.mock('@/backend/actions/refundProcessor', () => ({
  processPendingRefunds: mocks.processPendingRefunds,
}))

vi.mock('@/backend/db/prisma', () => ({
  prisma: {
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        order: { findFirst: mocks.orderFindFirst, update: mocks.orderUpdate },
        payment: { update: mocks.paymentUpdate },
        product: { update: mocks.productUpdate },
        refund: { create: mocks.refundCreate },
        auditLog: { create: mocks.auditLogCreate },
        $executeRaw: mocks.executeRaw,
      }),
  },
}))

import { cancelOrderByCustomer, cancelOrderByMerchant } from '@/backend/actions/cancellation'

describe('Institutional Money Safety & Order Cancellation', () => {
  const customerId = 'cust-1111-2222-3333-4444'
  const userId = 'user-1111-2222-3333-4444'
  const merchantId = 'merchant-1111-2222-3333-4444'
  const orderId = 'a1111111-2222-3333-4444-555555555555'

  beforeEach(() => {
    vi.resetAllMocks()
    mocks.requireCustomer.mockResolvedValue({
      user: { id: userId, email: 'customer@example.com' },
      customer: { id: customerId },
    })
    mocks.requireMerchant.mockResolvedValue({
      user: { id: userId, email: 'merchant@example.com' },
      merchant: { id: merchantId },
    })
    mocks.processPendingRefunds.mockResolvedValue({ attempted: 1, skipped: 0 })
  })

  describe('Customer Order Cancellation', () => {
    it('cancels PAYMENT_PENDING order cleanly without issuing refunds', async () => {
      mocks.orderFindFirst.mockResolvedValue({
        id: orderId,
        customerId,
        merchantId,
        status: 'PAYMENT_PENDING',
        totalAmount: 500000,
        currency: 'INR',
        payment: { id: 'pay-db-1', status: 'PENDING' },
        items: [],
      })

      const result = await cancelOrderByCustomer({ orderId, reason: 'Changed mind' })

      expect(result.success).toBe(true)
      expect(result.status).toBe('CANCELLED')
      expect(result.refundIssued).toBe(false)
      expect(mocks.orderUpdate).toHaveBeenCalledWith({
        where: { id: orderId },
        data: { status: 'CANCELLED' },
      })
      expect(mocks.paymentUpdate).toHaveBeenCalledWith({
        where: { id: 'pay-db-1' },
        data: { status: 'FAILED' },
      })
      expect(mocks.auditLogCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'ORDER_CANCELLED_BY_CUSTOMER',
            status: 'APPROVED',
          }),
        })
      )
    })

    it('cancels PAID order, restores product inventory, and queues full refund', async () => {
      const productId = 'b1111111-2222-3333-4444-555555555555'
      mocks.orderFindFirst.mockResolvedValue({
        id: orderId,
        customerId,
        merchantId,
        status: 'PAID',
        totalAmount: 1200000,
        currency: 'INR',
        razorpayPaymentId: 'pay_rzp_live_12345',
        payment: { id: 'pay-db-2', status: 'CAPTURED', razorpayPaymentId: 'pay_rzp_live_12345' },
        items: [
          {
            productId,
            quantity: 2,
            product: { id: productId, name: 'Pro Keyboard', inventory: 5 },
          },
        ],
      })

      mocks.refundCreate.mockResolvedValue({ id: 'refund-outbox-1' })

      const result = await cancelOrderByCustomer({ orderId, reason: 'Accidental purchase' })

      expect(result.success).toBe(true)
      expect(result.status).toBe('CANCELLED')
      expect(result.refundIssued).toBe(true)
      expect(result.refundId).toBe('refund-outbox-1')

      // Verifies inventory row lock and restoration increment
      expect(mocks.executeRaw).toHaveBeenCalled()
      expect(mocks.productUpdate).toHaveBeenCalledWith({
        where: { id: productId },
        data: { inventory: { increment: 2 } },
      })

      // Verifies refund outbox row creation
      expect(mocks.refundCreate).toHaveBeenCalledWith({
        data: {
          orderId,
          razorpayPaymentId: 'pay_rzp_live_12345',
          amount: 1200000,
          currency: 'INR',
        },
      })

      // Verifies audit log
      expect(mocks.auditLogCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'ORDER_CANCELLED_AND_REFUND_QUEUED',
            status: 'EXECUTED',
          }),
        })
      )
    })

    it('returns idempotent status if order is already cancelled', async () => {
      mocks.orderFindFirst.mockResolvedValue({
        id: orderId,
        customerId,
        merchantId,
        status: 'CANCELLED',
        items: [],
      })

      const result = await cancelOrderByCustomer({ orderId })
      expect(result.success).toBe(true)
      expect(result.status).toBe('CANCELLED')
      expect(mocks.orderUpdate).not.toHaveBeenCalled()
    })

    it('fails closed when attempting to cancel EXPIRED or PAYMENT_FAILED orders', async () => {
      mocks.orderFindFirst.mockResolvedValue({
        id: orderId,
        customerId,
        merchantId,
        status: 'EXPIRED',
        items: [],
      })

      await expect(cancelOrderByCustomer({ orderId })).rejects.toThrow('Cannot cancel order in EXPIRED state.')
    })
  })

  describe('Merchant Order Cancellation', () => {
    it('allows merchant to cancel a PAID order and queue refund with inventory restoration', async () => {
      const productId = 'c1111111-2222-3333-4444-555555555555'
      mocks.orderFindFirst.mockResolvedValue({
        id: orderId,
        merchantId,
        status: 'PAID',
        totalAmount: 750000,
        currency: 'INR',
        razorpayPaymentId: 'pay_rzp_merchant_cancel',
        payment: { id: 'pay-db-3', status: 'CAPTURED', razorpayPaymentId: 'pay_rzp_merchant_cancel' },
        items: [
          {
            productId,
            quantity: 1,
            product: { id: productId, name: 'Desk Mat', inventory: 10 },
          },
        ],
      })

      mocks.refundCreate.mockResolvedValue({ id: 'refund-outbox-merchant-1' })

      const result = await cancelOrderByMerchant({ orderId, reason: 'Customer requested phone cancellation' })

      expect(result.success).toBe(true)
      expect(result.status).toBe('CANCELLED')
      expect(result.refundIssued).toBe(true)
      expect(mocks.productUpdate).toHaveBeenCalledWith({
        where: { id: productId },
        data: { inventory: { increment: 1 } },
      })
      expect(mocks.auditLogCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'ORDER_CANCELLED_BY_MERCHANT_AND_REFUND_QUEUED',
            status: 'EXECUTED',
          }),
        })
      )
    })
  })
})
