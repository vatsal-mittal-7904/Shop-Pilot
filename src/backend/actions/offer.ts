'use server'

import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { prisma } from '@/backend/db/prisma'
import { requireCustomer } from '@/backend/auth/session'
import { cartSelectionBinding } from '@/backend/utils/cartSelectionBinding'
import { assertAccountSpendLimit } from '@/backend/actions/accountBudget'
import { checkDistributedRateLimit } from '@/backend/utils/rateLimit'

const acceptRecommendationSchema = z.object({
  recommendationId: z.string().uuid(),
  cartId: z.string().uuid(),
})

export async function acceptRecommendation(recommendationId: string, cartId: string) {
  const { user, customer } = await requireCustomer()

  const rateLimit = await checkDistributedRateLimit(`customer:recommendation-accept:${customer.id}`, {
    maxRequests: 20,
    windowMs: 60_000,
  })
  if (!rateLimit.allowed) {
    throw new Error('Rate limit exceeded for recommendation acceptance. Please wait a moment.')
  }

  const data = acceptRecommendationSchema.parse({ recommendationId, cartId })

  return prisma.$transaction(async (tx) => {
    const cart = await tx.cart.findFirst({ where: { id: data.cartId, customerId: customer.id } })
    if (!cart) throw new Error('Cart not found')
    if (cart.status !== 'ACTIVE') throw new Error('This cart is no longer active')

    const recommendation = await tx.recommendation.findUnique({
      where: { id: data.recommendationId },
      include: { agentAction: true }
    })

    if (!recommendation || recommendation.customerId !== customer.id) {
      throw new Error('Recommendation not found.')
    }
    if (recommendation.merchantId !== cart.merchantId) {
      throw new Error('Recommendation does not match cart merchant.')
    }
    if (recommendation.status === 'ACCEPTED' && recommendation.offerId) {
      const existingOffer = await tx.offer.findUnique({ where: { id: recommendation.offerId }, include: { items: { include: { product: true } } } })
      if (existingOffer) return existingOffer
    }
    if (recommendation.status !== 'PROPOSED') {
      throw new Error('This recommendation is no longer active.')
    }
    if (Date.now() - recommendation.createdAt.getTime() > 15 * 60 * 1000) {
      await tx.recommendation.update({ where: { id: recommendation.id }, data: { status: 'EXPIRED' } })
      throw new Error('This recommendation has expired.')
    }

    const authorizedAction = recommendation.agentAction
    if (!authorizedAction || authorizedAction.status !== 'APPROVED') {
      throw new Error('This specific discount was never authorized by the agent.')
    }

    const policyResult = authorizedAction.policyResult as { requested?: number } | null
    const discountPercent = policyResult?.requested ?? 0

    const recommendedProduct = await tx.product.findFirst({
      where: { id: recommendation.recommendedProductId, merchantId: cart.merchantId },
    })

    if (!recommendedProduct) {
      await tx.recommendation.update({ where: { id: recommendation.id }, data: { status: 'UNAVAILABLE' } })
      throw new Error('This product is not available from this merchant')
    }
    if (recommendedProduct.inventory < 1) {
      await tx.recommendation.update({ where: { id: recommendation.id }, data: { status: 'UNAVAILABLE' } })
      throw new Error('This product is out of stock')
    }

    const rawPolicies = await tx.merchantPolicy.findMany({ where: { merchantId: cart.merchantId } })
    const policies = Object.fromEntries(rawPolicies.map((p) => [p.key, p.value]))
    const maxDiscount = policies.MAX_DISCOUNT_PERCENTAGE ?? 0
    if (discountPercent > maxDiscount) {
      throw new Error(`Discount exceeds the ${maxDiscount}% merchant limit`)
    }

    const initialCartItems = await tx.cartItem.findMany({
      where: { cartId: cart.id },
      include: { product: true },
    })
    if (initialCartItems.length === 0) throw new Error('Cart is empty')

    if (initialCartItems.some((item) => item.product.inventory < item.quantity)) {
      throw new Error('An item in the cart is out of stock')
    }

    if (!recommendation.originalProductId) throw new Error('Original product ID missing from recommendation')
    const originalProductItem = initialCartItems.find(i => i.productId === recommendation.originalProductId)
    if (!originalProductItem) throw new Error('Original product not found in cart')

    let subtotal = 0, discount = 0, total = 0, offerItems: Array<{ productId: string; quantity: number; unitPrice: number; lineTotal: number }> = []
    let cost = 0

    if (recommendation.type === 'CROSS_SELL') {
      if (!originalProductItem.product.complementaryProducts.includes(recommendedProduct.id) && !originalProductItem.product.relatedProducts.includes(recommendedProduct.id)) {
        throw new Error('These products are no longer complementary')
      }

      const { calculateCrossSellPricing } = await import('@/backend/utils/recommendationPricing')
      const pricing = calculateCrossSellPricing({
        cartItems: initialCartItems,
        addonProduct: recommendedProduct,
        discountPercent
      })
      subtotal = pricing.subtotal
      discount = pricing.discountAmount
      total = pricing.total
      offerItems = pricing.offerItems

      cost = initialCartItems.reduce((sum, item) => sum + item.product.cost * item.quantity, 0) + (recommendedProduct.cost || 0)

      const existingAddonItem = initialCartItems.find(i => i.productId === recommendation.recommendedProductId)
      if (!existingAddonItem) {
        await tx.cartItem.create({ data: { cartId: cart.id, productId: recommendation.recommendedProductId, quantity: 1 } })
      } else {
        await tx.cartItem.update({
          where: { id: existingAddonItem.id },
          data: { quantity: existingAddonItem.quantity + 1 }
        })
      }

    } else if (recommendation.type === 'UPSELL') {
      if (recommendedProduct.price <= originalProductItem.product.price) {
        throw new Error('Upgrade product price must be strictly greater than original product price')
      }

      if (!originalProductItem.product.upgradeProducts.includes(recommendedProduct.id)) {
        throw new Error('This product is no longer a valid upgrade')
      }

      const { calculateUpsellPricing } = await import('@/backend/utils/recommendationPricing')
      const pricing = calculateUpsellPricing({
        cartItems: initialCartItems,
        originalProduct: originalProductItem.product,
        upgradeProduct: recommendedProduct,
        discountPercent
      })
      subtotal = pricing.subtotal
      discount = pricing.discountAmount
      total = pricing.total
      offerItems = pricing.offerItems

      cost = initialCartItems.reduce((sum, item) => {
        if (item.productId === recommendation.originalProductId) {
          return sum + item.product.cost * (item.quantity - 1)
        }
        return sum + item.product.cost * item.quantity
      }, 0) + (recommendedProduct.cost || 0)

      if (originalProductItem.quantity > 1) {
        await tx.cartItem.update({
          where: { id: originalProductItem.id },
          data: { quantity: originalProductItem.quantity - 1 }
        })
      } else {
        await tx.cartItem.delete({
          where: { id: originalProductItem.id }
        })
      }

      const existingUpgradeItem = initialCartItems.find(i => i.productId === recommendation.recommendedProductId)
      if (!existingUpgradeItem) {
        await tx.cartItem.create({ data: { cartId: cart.id, productId: recommendation.recommendedProductId, quantity: 1 } })
      } else {
        await tx.cartItem.update({
          where: { id: existingUpgradeItem.id },
          data: { quantity: existingUpgradeItem.quantity + 1 }
        })
      }
    } else {
      throw new Error('Invalid recommendation type')
    }

    const marginPercent = total > 0 ? ((total - cost) / total) * 100 : -Infinity
    if (marginPercent < (policies.MIN_MARGIN_PERCENTAGE ?? 0)) {
      throw new Error('Offer would violate the minimum merchant margin')
    }

    await assertAccountSpendLimit(tx, customer.id, cart.merchantId, total)

    // Keep checkout validation aligned with catalog search: a refined intent
    // updates an existing record without changing createdAt.
    const intent = await tx.buyerIntent.findFirst({ where: { customerId: customer.id }, orderBy: { updatedAt: 'desc' } })
    if (intent?.maximumAmount) {
      const pastOrders = await tx.order.findMany({
        where: { buyerIntentId: intent.id, status: { notIn: ['DRAFT', 'PAYMENT_FAILED', 'CANCELLED', 'EXPIRED'] } },
        select: { totalAmount: true },
      })
      const currentSpend = pastOrders.reduce((sum, order) => sum + order.totalAmount, 0)
      if (currentSpend + total > intent.maximumAmount) {
        throw new Error('Offer exceeds the cumulative buyer intent budget')
      }
    }

    const created = await tx.offer.create({
      data: {
        merchantId: cart.merchantId,
        customerId: customer.id,
        buyerIntentId: intent?.id,
        cartId: cart.id,
        cartSnapshotHash: cartSelectionBinding({
          customerId: customer.id,
          merchantId: cart.merchantId,
          cartId: cart.id,
          items: offerItems.map((item) => ({ productId: item.productId, quantity: item.quantity, unitPrice: item.unitPrice })),
        }),
        subtotal,
        discount,
        total,
        discountPercent,
        status: 'ACTIVE',
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        items: {
          create: offerItems.map(item => ({
            productId: item.productId,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
          })),
        },
      },
      include: { items: { include: { product: true } } },
    })

    await tx.recommendation.update({
      where: { id: recommendation.id },
      data: { status: 'ACCEPTED', offerId: created.id }
    })

    await tx.auditLog.create({
      data: {
        merchantId: cart.merchantId,
        actorUserId: user.id,
        action: 'RECOMMENDATION_ACCEPTED',
        status: 'APPROVED',
        reason: 'Recommendation accepted securely via unified authoritative transaction',
        details: {
          offerId: created.id,
          cartId: cart.id,
          recommendedProductId: recommendation.recommendedProductId,
          originalProductId: recommendation.originalProductId,
          discountPercent,
          marginPercent,
          type: recommendation.type
        } as Prisma.InputJsonValue,
      },
    })

    return created
  }, { isolationLevel: 'Serializable' })
}

export async function declineRecommendation(recommendationId: string) {
  const { customer } = await requireCustomer()

  const rateLimit = await checkDistributedRateLimit(`customer:recommendation-decline:${customer.id}`, {
    maxRequests: 20,
    windowMs: 60_000,
  })
  if (!rateLimit.allowed) {
    throw new Error('Rate limit exceeded. Please wait a moment.')
  }

  const recommendation = await prisma.recommendation.findUnique({ where: { id: recommendationId } })
  if (!recommendation || recommendation.customerId !== customer.id) {
    throw new Error('Recommendation not found.')
  }
  if (recommendation.status !== 'PROPOSED') return recommendation

  return prisma.recommendation.update({
    where: { id: recommendationId },
    data: { status: 'DECLINED' }
  })
}
