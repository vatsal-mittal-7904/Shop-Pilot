import { test, describe, afterAll, vi, expect } from 'vitest'
import { prisma } from '@/backend/db/prisma'
import { cancelOrderByCustomer, cancelOrderByMerchant } from '@/backend/actions/cancellation'

const adminEmail = 'admin@technest.com'

afterAll(async () => {
  await prisma.refund.deleteMany({
    where: { razorpayPaymentId: { startsWith: 'pay_' } },
  })
  await prisma.$disconnect()
})

async function getMerchantContext() {
  const user = await prisma.user.findUniqueOrThrow({ where: { email: adminEmail } })
  const merchant = await prisma.merchant.findUniqueOrThrow({ where: { ownerId: user.id } })
  return { user, merchant }
}

async function getCustomerContext() {
  const customer = await prisma.customer.findFirstOrThrow({ include: { user: true } })
  return { user: customer.user, customer }
}

vi.mock('@/backend/auth/session', () => ({
  requireCustomer: () => getCustomerContext(),
  requireMerchant: () => getMerchantContext(),
}))

vi.mock('@/backend/actions/refundProcessor', () => ({
  processPendingRefunds: vi.fn().mockResolvedValue({ attempted: 1, skipped: 0 }),
}))

describe('PostgreSQL Integration: Order Cancellation & Money Safety Invariants', () => {
  test('Customer cancels PAYMENT_PENDING order cleanly', async () => {
    const { customer } = await getCustomerContext()
    const { merchant } = await getMerchantContext()

    const order = await prisma.order.create({
      data: {
        merchantId: merchant.id,
        customerId: customer.id,
        status: 'PAYMENT_PENDING',
        totalAmount: 149900,
        currency: 'INR',
        payment: {
          create: {
            amount: 149900,
            status: 'PENDING',
          },
        },
      },
    })

    const result = await cancelOrderByCustomer({ orderId: order.id, reason: 'Found cheaper elsewhere' })

    expect(result.success).toBe(true)
    expect(result.status).toBe('CANCELLED')
    expect(result.refundIssued).toBe(false)

    const updatedOrder = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      include: { payment: true },
    })
    expect(updatedOrder.status).toBe('CANCELLED')
    expect(updatedOrder.payment?.status).toBe('FAILED')

    const auditLog = await prisma.auditLog.findFirst({
      where: { orderId: order.id, action: 'ORDER_CANCELLED_BY_CUSTOMER' },
    })
    expect(auditLog).toBeDefined()
    expect(auditLog?.status).toBe('APPROVED')
  })

  test('Customer cancels PAID order: restores inventory and enqueues full refund', async () => {
    const { customer } = await getCustomerContext()
    const { merchant } = await getMerchantContext()
    const paymentId = `pay_cancel_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`

    const product = await prisma.product.create({
      data: {
        merchantId: merchant.id,
        name: 'Cancellation Safety Test Product',
        category: 'Accessories',
        price: 99900,
        cost: 40000,
        inventory: 8, // starting inventory
        attributes: {},
      },
    })

    const order = await prisma.order.create({
      data: {
        merchantId: merchant.id,
        customerId: customer.id,
        status: 'PAID',
        totalAmount: 99900,
        currency: 'INR',
        razorpayPaymentId: paymentId,
        items: {
          create: [
            {
              productId: product.id,
              quantity: 2,
              unitPrice: 99900,
            },
          ],
        },
        payment: {
          create: {
            amount: 99900,
            status: 'CAPTURED',
            razorpayPaymentId: paymentId,
          },
        },
      },
    })

    const result = await cancelOrderByCustomer({ orderId: order.id, reason: 'Accidental order' })

    expect(result.success).toBe(true)
    expect(result.status).toBe('CANCELLED')
    expect(result.refundIssued).toBe(true)
    expect(result.refundId).toBeDefined()

    // Invariant 1: Inventory restored atomically
    const updatedProduct = await prisma.product.findUniqueOrThrow({ where: { id: product.id } })
    expect(updatedProduct.inventory).toBe(10) // 8 + 2 restored

    // Invariant 2: Order marked CANCELLED
    const updatedOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } })
    expect(updatedOrder.status).toBe('CANCELLED')

    // Invariant 3: Durable Refund Outbox entry created
    const refund = await prisma.refund.findFirstOrThrow({ where: { orderId: order.id } })
    expect(refund.amount).toBe(99900)
    expect(refund.razorpayPaymentId).toBe(paymentId)
    expect(refund.status).toBe('PENDING')
  })

  test('Merchant cancels PAID order: restores inventory and enqueues refund', async () => {
    const { customer } = await getCustomerContext()
    const { merchant } = await getMerchantContext()
    const merchantPaymentId = `pay_merch_cancel_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`

    const product = await prisma.product.create({
      data: {
        merchantId: merchant.id,
        name: 'Merchant Cancel Test Product',
        category: 'Hardware',
        price: 250000,
        cost: 100000,
        inventory: 5,
        attributes: {},
      },
    })

    const order = await prisma.order.create({
      data: {
        merchantId: merchant.id,
        customerId: customer.id,
        status: 'PAID',
        totalAmount: 250000,
        currency: 'INR',
        razorpayPaymentId: merchantPaymentId,
        items: {
          create: [
            {
              productId: product.id,
              quantity: 1,
              unitPrice: 250000,
            },
          ],
        },
        payment: {
          create: {
            amount: 250000,
            status: 'CAPTURED',
            razorpayPaymentId: merchantPaymentId,
          },
        },
      },
    })

    const result = await cancelOrderByMerchant({ orderId: order.id, reason: 'Item recalled by vendor' })

    expect(result.success).toBe(true)
    expect(result.status).toBe('CANCELLED')
    expect(result.refundIssued).toBe(true)

    // Inventory restored
    const updatedProduct = await prisma.product.findUniqueOrThrow({ where: { id: product.id } })
    expect(updatedProduct.inventory).toBe(6) // 5 + 1

    // Refund row verified
    const refund = await prisma.refund.findFirstOrThrow({ where: { orderId: order.id } })
    expect(refund.amount).toBe(250000)
  })
})
