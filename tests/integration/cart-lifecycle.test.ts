import { test, describe, afterAll, vi, expect } from 'vitest'
import { prisma } from '@/backend/db/prisma'

const adminEmail = 'admin@technest.com'

afterAll(async () => {
  await prisma.paymentReconciliation.deleteMany({
    where: { order: { razorpayOrderId: { startsWith: 'order_fake_' } } },
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
  requireMerchant: () => getMerchantContext()
}))

vi.mock('@/backend/services/razorpay', () => {
  let counter = Date.now()
  return {
    razorpay: {
      orders: {
        all: vi.fn().mockResolvedValue({ items: [] }),
        fetchPayments: vi.fn().mockResolvedValue({ items: [] }),
        fetch: vi.fn().mockResolvedValue({ status: 'created' }),
        create: vi.fn().mockImplementation(async (args) => {
          return { id: `order_fake_${counter++}`, amount: args.amount, currency: args.currency }
        })
      }
    }
  }
})

// These are database-backed state-transition tests. Razorpay is deliberately
// mocked so they can construct captured/failed outcomes deterministically;
// they are not evidence that the Razorpay API or Checkout integration works.
// The opt-in, non-mocked provider contract is tests/e2e/razorpay-provider.spec.ts.
describe('Simulated cart lifecycle and checkout state transitions', () => {
  test('Successful webhook payment converts cart and updates inventory', async () => {
    const { customer, user } = await getCustomerContext()
    const { merchant } = await getMerchantContext()
    
    // Create product
    const product = await prisma.product.create({
      data: {
        merchantId: merchant.id,
        name: 'Test Lifecycle Product',
        category: 'Test',
        price: 100000,
        cost: 50000,
        inventory: 10,
        attributes: {},
      }
    })
    
    // Create Cart
    const cart = await prisma.cart.create({
      data: {
        merchantId: merchant.id,
        customerId: customer.id,
        status: 'ACTIVE',
        items: {
          create: [{ productId: product.id, quantity: 2 }]
        }
      }
    })
    
    // Create Offer
    const offer = await prisma.offer.create({
      data: {
        merchantId: merchant.id,
        customerId: customer.id,
        cartId: cart.id,
        subtotal: 200000,
        discount: 0,
        total: 200000,
        discountPercent: 0,
        expiresAt: new Date(Date.now() + 10000),
        status: 'ACCEPTED',
        acceptedAt: new Date(),
        acceptedByUserId: user.id,
        items: {
          create: [{ productId: product.id, quantity: 2, unitPrice: 100000 }]
        }
      }
    })
    
    // Call createOrReuseCheckoutOrder
    const { createOrReuseCheckoutOrder } = await import('@/backend/actions/order')
    const { internalOrderId, razorpayOrder } = await createOrReuseCheckoutOrder(offer.id)
    
    // Verify Cart is still ACTIVE
    const cartAfterOrder = await prisma.cart.findUnique({ where: { id: cart.id } })
    expect(cartAfterOrder?.status).toBe('ACTIVE')
    
    // Process webhook payment.captured
    const { processRazorpayEvent } = await import('@/backend/actions/webhookProcessor')
    await processRazorpayEvent({
      razorpayEventId: `evt_${Date.now()}`,
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: `pay_${Date.now()}_${Math.random()}`,
            order_id: razorpayOrder.id,
            amount: 200000,
            currency: 'INR',
          }
        }
      }
    })
    
    // Verify Order is PAID
    const orderAfterWebhook = await prisma.order.findUnique({ where: { id: internalOrderId } })
    expect(orderAfterWebhook?.status).toBe('PAID')
    
    // Verify Cart is CONVERTED
    const cartAfterWebhook = await prisma.cart.findUnique({ where: { id: cart.id } })
    expect(cartAfterWebhook?.status).toBe('CONVERTED')
    
    // Verify Inventory decremented by 2
    const productAfter = await prisma.product.findUnique({ where: { id: product.id } })
    expect(productAfter?.inventory).toBe(8)
  })

  test('Failed webhook preserves active cart', async () => {
    const { customer, user } = await getCustomerContext()
    const { merchant } = await getMerchantContext()
    
    const product = await prisma.product.create({
      data: { merchantId: merchant.id, name: 'Test Failed', category: 'Test', price: 100, cost: 50, inventory: 5, attributes: {} }
    })
    
    const cart = await prisma.cart.create({
      data: { merchantId: merchant.id, customerId: customer.id, status: 'ACTIVE', items: { create: [{ productId: product.id, quantity: 1 }] } }
    })
    
    const offer = await prisma.offer.create({
      data: { merchantId: merchant.id, customerId: customer.id, cartId: cart.id, subtotal: 100, discount: 0, total: 100, discountPercent: 0, expiresAt: new Date(Date.now() + 10000), status: 'ACCEPTED', acceptedAt: new Date(), acceptedByUserId: user.id, items: { create: [{ productId: product.id, quantity: 1, unitPrice: 100 }] } }
    })
    
    const { createOrReuseCheckoutOrder } = await import('@/backend/actions/order')
    const { internalOrderId, razorpayOrder } = await createOrReuseCheckoutOrder(offer.id)
    
    const { processRazorpayEvent } = await import('@/backend/actions/webhookProcessor')
    await processRazorpayEvent({
      razorpayEventId: `evt_${Date.now()}_failed`,
      event: 'payment.failed',
      payload: {
        payment: {
          entity: { id: 'pay_failed123_1788062933', order_id: razorpayOrder.id, amount: 100, currency: 'INR' }
        }
      }
    })
    
    const orderAfterWebhook = await prisma.order.findUnique({ where: { id: internalOrderId } })
    expect(orderAfterWebhook?.status).toBe('PAYMENT_FAILED')
    
    const cartAfterWebhook = await prisma.cart.findUnique({ where: { id: cart.id } })
    expect(cartAfterWebhook?.status).toBe('ACTIVE') // Cart remains ACTIVE
  })
  
  test('Duplicate concurrent checkout requests return the existing pending order without creating duplicate rows', async () => {
    const { customer, user } = await getCustomerContext()
    const { merchant } = await getMerchantContext()
    
    const product = await prisma.product.create({
      data: { merchantId: merchant.id, name: 'Test Dup', category: 'Test', price: 100, cost: 50, inventory: 5, attributes: {} }
    })
    
    const cart = await prisma.cart.create({
      data: { merchantId: merchant.id, customerId: customer.id, status: 'ACTIVE', items: { create: [{ productId: product.id, quantity: 1 }] } }
    })
    
    const offer = await prisma.offer.create({
      data: { merchantId: merchant.id, customerId: customer.id, cartId: cart.id, subtotal: 100, discount: 0, total: 100, discountPercent: 0, expiresAt: new Date(Date.now() + 10000), status: 'ACCEPTED', acceptedAt: new Date(), acceptedByUserId: user.id, items: { create: [{ productId: product.id, quantity: 1, unitPrice: 100 }] } }
    })
    
    const { createOrReuseCheckoutOrder } = await import('@/backend/actions/order')
    const result1 = await createOrReuseCheckoutOrder(offer.id)
    const result2 = await createOrReuseCheckoutOrder(offer.id)
    
    expect(result1.internalOrderId).toBe(result2.internalOrderId)
    expect(result1.razorpayOrder.id).toBe(result2.razorpayOrder.id)
    
    const ordersCount = await prisma.order.count({ where: { offerId: offer.id } })
    expect(ordersCount).toBe(1)
  })
  
  test('Expired offer rejection', async () => {
    const { customer, user } = await getCustomerContext()
    const { merchant } = await getMerchantContext()
    
    const offer = await prisma.offer.create({
      data: { merchantId: merchant.id, customerId: customer.id, subtotal: 100, discount: 0, total: 100, discountPercent: 0, expiresAt: new Date(Date.now() - 10000), status: 'ACCEPTED', acceptedAt: new Date(), acceptedByUserId: user.id, items: {} }
    })
    
    const { createOrReuseCheckoutOrder } = await import('@/backend/actions/order')
    
    await expect(createOrReuseCheckoutOrder(offer.id)).rejects.toThrow(/expired/)
  })
})
