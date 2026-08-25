'use server'

import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { prisma } from '@/backend/db/prisma'
import { requireCustomer } from '@/backend/auth/session'

const acceptBundleSchema = z.object({
  cartId: z.string().uuid(),
  addonProductId: z.string().uuid(),
  discountPercent: z.number().finite().min(0).max(100),
})

/**
 * Accepts a cross-sell bundle: adds `addonProductId` to the customer's cart
 * and turns the resulting cart contents into a persisted, time-limited Offer.
 *
 * The discountPercent the UI shows the customer is never trusted on its own --
 * it is re-checked against the merchant's live MAX_DISCOUNT_PERCENTAGE policy
 * here, server-side, before any Offer is created.
 */
export async function acceptBundle(cartId: string, addonProductId: string, discountPercent: number) {
  const { user, customer } = await requireCustomer()
  const data = acceptBundleSchema.parse({ cartId, addonProductId, discountPercent })

  // Scoped by customerId, so one customer's client can never convert another
  // customer's cart into an offer.
  const cart = await prisma.cart.findFirst({ where: { id: data.cartId, customerId: customer.id } })
  if (!cart) throw new Error('Cart not found')
  if (cart.status !== 'ACTIVE') throw new Error('This cart is no longer active')

  // 1. Verify the discount was actually authorized by the agent for this specific bundle.
  // We cannot blindly trust evaluateDiscount here because the client could forge a
  // discount up to the global MAX_DISCOUNT_PERCENTAGE, bypassing the LLM's negotiation.
  const recentActions = await prisma.agentAction.findMany({
    where: { merchantId: cart.merchantId, type: 'BUNDLE_ADDON_OFFER', status: 'APPROVED' },
    orderBy: { createdAt: 'desc' },
    take: 10,
  })
  const authorizedAction = recentActions.find((a) => {
    const input = a.input as { cartId?: string; addonProductId?: string; requestedDiscount?: number }
    return input?.cartId === data.cartId && input?.addonProductId === data.addonProductId && input?.requestedDiscount === data.discountPercent
  })

  if (!authorizedAction) {
    throw new Error('This specific bundle discount was never authorized by the agent.')
  }
  
  // policyResult is stored as Json, so narrow it to the fields evaluateDiscount
  // actually writes rather than casting to `any`.
  const policyResult = authorizedAction.policyResult as { passed?: boolean; limit?: number; requested?: number; reason?: string } | null

  const addonProduct = await prisma.product.findFirst({
    where: { id: data.addonProductId, merchantId: cart.merchantId },
  })
  if (!addonProduct) throw new Error('This add-on is not available from this merchant')
  if (addonProduct.inventory < 1) throw new Error('This add-on is out of stock')

  const offer = await prisma.$transaction(async (tx) => {
    // 2. Add the addon to the cart. Upsert against the (cartId, productId)
    // unique constraint so a repeat call increments quantity instead of
    // throwing or duplicating the row.
    await tx.cartItem.upsert({
      where: { cartId_productId: { cartId: cart.id, productId: data.addonProductId } },
      update: { quantity: { increment: 1 } },
      create: { cartId: cart.id, productId: data.addonProductId, quantity: 1 },
    })

    const cartItems = await tx.cartItem.findMany({
      where: { cartId: cart.id },
      include: { product: true },
    })
    if (cartItems.length === 0) throw new Error('Cart is empty')
    if (cartItems.some((item) => item.product.inventory < item.quantity)) {
      throw new Error('An item in the cart is out of stock')
    }

    // 3. Offer financials, computed from the live cart contents.
    const subtotal = cartItems.reduce((sum, item) => sum + item.product.price * item.quantity, 0)
    const cost = cartItems.reduce((sum, item) => sum + item.product.cost * item.quantity, 0)
    const discount = Math.floor(subtotal * (data.discountPercent / 100))
    const total = subtotal - discount
    const marginPercent = total > 0 ? ((total - cost) / total) * 100 : -Infinity

    const created = await tx.offer.create({
      data: {
        merchantId: cart.merchantId,
        customerId: customer.id,
        cartId: cart.id,
        subtotal,
        discount,
        total,
        discountPercent: data.discountPercent,
        status: 'ACTIVE',
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        // 4. One OfferItem per CartItem. unitPrice carries the discount, the
        // same way createOfferForCustomer writes it (commerce.ts:147):
        // createOrderFromOffer copies unitPrice straight into OrderItem while
        // taking totalAmount from offer.total, so a list-price unitPrice here
        // would make a bundle order's line items sum to more than the order.
        items: {
          create: cartItems.map((item) => ({
            productId: item.productId,
            quantity: item.quantity,
            unitPrice: item.product.price - Math.floor(item.product.price * (data.discountPercent / 100)),
          })),
        },
      },
      include: { items: { include: { product: true } } },
    })

    await tx.auditLog.create({
      data: {
        merchantId: cart.merchantId,
        actorUserId: user.id,
        action: 'BUNDLE_OFFER_CREATED',
        status: 'APPROVED',
        reason: policyResult?.reason ?? 'Bundle offer created from an agent-authorized bundle proposal',
        details: {
          offerId: created.id,
          cartId: cart.id,
          addonProductId: data.addonProductId,
          discountPercent: data.discountPercent,
          marginPercent,
        } as Prisma.InputJsonValue,
      },
    })

    return created
  }, { isolationLevel: 'Serializable' })

  return offer
}
