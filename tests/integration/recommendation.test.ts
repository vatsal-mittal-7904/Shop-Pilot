import { test, describe, afterAll, expect, vi } from 'vitest'
import { prisma } from '../../src/backend/db/prisma'

const adminEmail = 'admin@technest.com' // Changed to a real user in the seed file

afterAll(async () => {
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
    requireCustomer: getCustomerContext,
    requireMerchant: getMerchantContext
  }))

describe('Recommendation Flow', () => {
  test('acceptBundle processes successfully and is idempotent', async () => {
    const { acceptRecommendation } = await import('../../src/backend/actions/offer')
    const { getMerchantROI } = await import('../../src/backend/actions/analytics')

    const { merchant } = await getMerchantContext()
    const { customer } = await getCustomerContext()
    
    await prisma.cart.deleteMany({ where: { customerId: customer.id } })

    const cart = await prisma.cart.create({
      data: { customerId: customer.id, merchantId: merchant.id, status: 'ACTIVE' }
    })
    
    const keyboard = await prisma.product.findFirstOrThrow({ where: { name: 'Wireless Mechanical Keyboard', merchantId: merchant.id } })
    const mouse = await prisma.product.findFirstOrThrow({ where: { category: 'mouse', merchantId: merchant.id } })
    
    await prisma.cartItem.create({
      data: { cartId: cart.id, productId: keyboard.id, quantity: 1 }
    })

    const conversation = await prisma.conversation.create({
      data: { customerId: customer.id, merchantId: merchant.id, messages: [] }
    })

    const agentAction = await prisma.agentAction.create({
      data: {
        merchantId: merchant.id,
        conversationId: conversation.id,
        type: 'BUNDLE_ADDON_OFFER',
        status: 'APPROVED',
        reason: 'Authorized discount',
        input: { cartId: cart.id, addonProductId: mouse.id, requestedDiscount: 10 },
        policyResult: { passed: true, requested: 10 }
      }
    })

    const recommendation = await prisma.recommendation.create({
      data: {
        merchantId: merchant.id,
        customerId: customer.id,
        conversationId: conversation.id,
        type: 'CROSS_SELL',
        status: 'PROPOSED',
        originalProductId: keyboard.id,
        recommendedProductId: mouse.id,
        agentActionId: agentAction.id
      }
    })

    const initialRoi = await getMerchantROI(merchant.id)
    expect(initialRoi).toBeDefined()

    const offer1 = await acceptRecommendation(recommendation.id, cart.id)
    expect(offer1.id).toBeTruthy()
    expect(offer1.items.length).toBe(2)
    expect(offer1.discount).toBe(Math.floor(mouse.price * 0.10))
    
    const recAfter1 = await prisma.recommendation.findUniqueOrThrow({ where: { id: recommendation.id } })
    expect(recAfter1.status).toBe('ACCEPTED')
    expect(recAfter1.offerId).toBe(offer1.id)

    const offer2 = await acceptRecommendation(recommendation.id, cart.id)
    expect(offer1.id).toBe(offer2.id)

    const newRoi = await getMerchantROI(merchant.id)
    expect(newRoi.totalRevenueGenerated).toBeGreaterThanOrEqual(0)
  })

  test('acceptUpsell swaps product and generates offer', async () => {
    const { acceptRecommendation } = await import('../../src/backend/actions/offer')
    const { getMerchantROI } = await import('../../src/backend/actions/analytics')

    const { merchant } = await getMerchantContext()
    const { customer } = await getCustomerContext()
    
    await prisma.cart.deleteMany({ where: { customerId: customer.id } })

    const cart = await prisma.cart.create({
      data: { customerId: customer.id, merchantId: merchant.id, status: 'ACTIVE' }
    })
    
    const standardKeyboard = await prisma.product.findFirstOrThrow({ where: { name: 'Wireless Mechanical Keyboard', merchantId: merchant.id } })
    const proKeyboard = await prisma.product.findFirstOrThrow({ where: { name: 'Pro Wireless Mechanical Keyboard', merchantId: merchant.id } })
    
    await prisma.cartItem.create({
      data: { cartId: cart.id, productId: standardKeyboard.id, quantity: 1 }
    })

    const conversation = await prisma.conversation.create({
      data: { customerId: customer.id, merchantId: merchant.id, messages: [] }
    })

    const agentAction = await prisma.agentAction.create({
      data: {
        merchantId: merchant.id,
        conversationId: conversation.id,
        type: 'UPSELL_OFFER',
        status: 'APPROVED',
        reason: 'Authorized discount',
        input: { cartId: cart.id, upgradeProductId: proKeyboard.id, requestedDiscount: 5 },
        policyResult: { passed: true, requested: 5 }
      }
    })

    const recommendation = await prisma.recommendation.create({
      data: {
        merchantId: merchant.id,
        customerId: customer.id,
        conversationId: conversation.id,
        type: 'UPSELL',
        status: 'PROPOSED',
        originalProductId: standardKeyboard.id,
        recommendedProductId: proKeyboard.id,
        agentActionId: agentAction.id
      }
    })

    const initialRoi = await getMerchantROI(merchant.id)
    expect(initialRoi).toBeDefined()

    const offer = await acceptRecommendation(recommendation.id, cart.id)
    expect(offer.id).toBeTruthy()
    expect(offer.items.length).toBe(1)
    expect(offer.items[0].product.id).toBe(proKeyboard.id)
    expect(offer.discount).toBe(Math.floor(proKeyboard.price * 0.05))

    const recAfter = await prisma.recommendation.findUniqueOrThrow({ where: { id: recommendation.id } })
    expect(recAfter.status).toBe('ACCEPTED')

    const finalRoi = await getMerchantROI(merchant.id)
    expect(finalRoi.totalRevenueGenerated).toBeGreaterThanOrEqual(0)
  })
})
