'use server'

import { z } from 'zod'
import { prisma } from '@/backend/db/prisma'
import { requireCustomer } from '@/backend/auth/session'
import { createRazorpayOrder } from '@/backend/actions/payment'
import { bindingsMatch, cartSelectionBinding } from '@/backend/utils/cartSelectionBinding'
import { assertAccountSpendLimit } from '@/backend/actions/accountBudget'

type SelectionLine = { productId: string; quantity: number }

function selectionsMatch(left: SelectionLine[], right: SelectionLine[]) {
  if (left.length !== right.length) return false
  const canonical = (items: SelectionLine[]) =>
    [...items]
      .sort((a, b) => a.productId.localeCompare(b.productId) || a.quantity - b.quantity)
      .map((item) => `${item.productId}:${item.quantity}`)
      .join('|')
  return canonical(left) === canonical(right)
}

/**
 * Records a customer's acceptance of one immutable offer before checkout.
 *
 * This is deliberately a separate server action from Razorpay-order creation:
 * an LLM can produce an offer ID, but it cannot transition that offer into the
 * accepted state. Only an authenticated customer action can do that.
 */
export async function acceptOfferForCheckout(offerId: string) {
  const { user, customer } = await requireCustomer()
  const parsedOfferId = z.string().uuid().parse(offerId)

  return prisma.$transaction(async (tx) => {
    const offer = await tx.offer.findFirst({
      where: { id: parsedOfferId, customerId: customer.id },
      select: {
        id: true,
        merchantId: true,
        total: true,
        status: true,
        expiresAt: true,
        acceptedAt: true,
        acceptedByUserId: true,
        cartId: true,
        campaignId: true,
        cartSnapshotHash: true,
        items: { include: { product: { select: { inventory: true } } } },
      },
    })
    if (!offer) throw new Error('Offer not found')
    if (offer.status === 'ACCEPTED') {
      if (!offer.acceptedAt || !offer.acceptedByUserId) {
        throw new Error('Offer acceptance record is incomplete. Please request a fresh offer.')
      }
      return { offerId: offer.id, acceptedAt: offer.acceptedAt, alreadyAccepted: true as const }
    }
    if (offer.status !== 'ACTIVE' || offer.expiresAt <= new Date()) {
      if (offer.status === 'ACTIVE' && offer.expiresAt <= new Date()) {
        await tx.offer.update({ where: { id: offer.id }, data: { status: 'EXPIRED' } })
      }
      throw new Error('This offer is no longer active. Please request a fresh offer.')
    }
    if (offer.items.some((item) => item.product.inventory < item.quantity)) {
      throw new Error('An item in this offer is no longer available. Please request a fresh offer.')
    }
    // Basket binding. The rule is now unconditional: if an offer carries a
    // binding, it MUST verify. This block used to be guarded by
    // `!offer.campaignId`, which meant setting a campaign id switched off the
    // only check tying an offer to the shopper's actual basket -- the flag was
    // doing security work it was never designed for.
    if (offer.cartSnapshotHash) {
      if (!offer.cartId) {
        throw new Error('This offer has a basket binding but no basket. Please request a fresh offer.')
      }

      // Cart writes take this same customer row lock (cart.ts). Holding it
      // through the comparison and acceptance prevents an add/remove/quantity
      // change from interleaving after we validated the basket but before this
      // exact offer becomes accepted.
      await tx.$executeRaw`SELECT 1 FROM "Customer" WHERE id = ${customer.id} FOR UPDATE`
      const liveCart = await tx.cart.findFirst({
        where: {
          id: offer.cartId,
          customerId: customer.id,
          merchantId: offer.merchantId,
          status: 'ACTIVE',
        },
        select: { items: { select: { productId: true, quantity: true } } },
      })
      if (!liveCart || !selectionsMatch(
        liveCart.items,
        offer.items.map((item) => ({ productId: item.productId, quantity: item.quantity })),
      )) {
        throw new Error('Your basket changed after this offer was created. Please request a fresh offer.')
      }

      // The HMAC protects the offer's server-created snapshot (including its
      // discounted line prices); the live selection check above establishes
      // freshness against the cart the customer currently owns.
      const expectedBinding = cartSelectionBinding({
        customerId: customer.id,
        merchantId: offer.merchantId,
        cartId: offer.cartId,
        items: offer.items.map((item) => ({ productId: item.productId, quantity: item.quantity, unitPrice: item.unitPrice })),
      })
      if (!bindingsMatch(expectedBinding, offer.cartSnapshotHash)) {
        throw new Error('This offer no longer matches the customer-selected basket. Please request a fresh offer.')
      }
    } else if (offer.cartId) {
      // The only offers legitimately allowed to reference a cart with no
      // binding are merchant-side recovery offers: those are generated from an
      // already-abandoned cart by a campaign, not from a live basket, so there
      // was no customer selection to bind at creation time. The campaign must
      // still genuinely belong to this offer's merchant.
      const recoveryCampaign = offer.campaignId
        ? await tx.campaign.findFirst({
            where: { id: offer.campaignId, merchantId: offer.merchantId },
            select: { id: true },
          })
        : null
      if (!recoveryCampaign) {
        throw new Error('This offer is missing its verified basket selection. Please request a fresh offer.')
      }
    }

    const acceptedAt = new Date()
    await tx.offer.update({
      where: { id: offer.id },
      data: { status: 'ACCEPTED', acceptedAt, acceptedByUserId: user.id },
    })
    // Recovery offers originate from an abandoned cart. Once the customer
    // accepts one, revive that cart so the verified payment webhook can apply
    // its normal cart-conversion logic after capture.
    if (offer.campaignId && offer.cartId) {
      await tx.cart.updateMany({
        where: { id: offer.cartId, customerId: customer.id, status: 'ABANDONED' },
        data: { status: 'ACTIVE' },
      })
    }
    await tx.auditLog.create({
      data: {
        merchantId: offer.merchantId,
        actorUserId: user.id,
        action: 'OFFER_ACCEPTED_BY_CUSTOMER',
        status: 'APPROVED',
        reason: 'Customer explicitly accepted the exact offer before checkout.',
        details: { offerId: offer.id, total: offer.total, currency: 'INR', acceptedAt: acceptedAt.toISOString() },
      },
    })

    return { offerId: offer.id, acceptedAt, alreadyAccepted: false as const }
  }, { isolationLevel: 'Serializable' })
}

export async function createOrReuseCheckoutOrder(offerId: string) {
  const { user, customer } = await requireCustomer()
  const parsedOfferId = z.string().uuid().parse(offerId)

  // We wrap internal order creation in a transaction
  const order = await prisma.$transaction(async (tx) => {
    const offer = await tx.offer.findFirst({
      where: { id: parsedOfferId, customerId: customer.id },
      include: { items: { include: { product: true } }, buyerIntent: true, order: true },
    })

    if (!offer) throw new Error('Offer not found')

    if (offer.status !== 'ACCEPTED') {
      if (offer.status === 'ACTIVE' && offer.expiresAt <= new Date()) {
        await tx.offer.update({ where: { id: offer.id }, data: { status: 'EXPIRED' } })
      }
      throw new Error('Customer acceptance is required before checkout can begin.')
    }
    if (!offer.acceptedAt || !offer.acceptedByUserId) {
      throw new Error('A persisted customer acceptance record is required before checkout can begin.')
    }

    const now = new Date()

    if (offer.order) {
      // If a provider order was ALREADY created at Razorpay before expiry, reuse it
      if (offer.order.razorpayOrderId) {
        if (offer.order.status !== 'PAYMENT_PENDING') {
          throw new Error(`This offer already has an order in progress (status: ${offer.order.status}). Ask the customer to request a fresh offer to restart checkout.`)
        }
        return offer.order
      }

      // If no provider order exists yet, enforce offer expiration
      if (offer.expiresAt <= now) {
        await tx.order.update({
          where: { id: offer.order.id },
          data: { status: 'EXPIRED' },
        })
        await tx.offer.update({
          where: { id: offer.id },
          data: { status: 'EXPIRED' },
        })
        throw new Error('This offer has expired. Please ask for a fresh offer before checking out.')
      }

      if (offer.order.status === 'INVENTORY_FAILED') {
         // Try to recover it
         const shortItem = offer.items.find((item) => item.product.inventory < item.quantity)
         if (shortItem) {
           throw new Error(`${shortItem.product.name} is no longer available in the requested quantity. Please ask for a fresh offer.`)
         }
         const updatedOrder = await tx.order.update({
           where: { id: offer.order.id },
           data: { status: 'PAYMENT_PENDING' }
         })
         return updatedOrder
      }
      if (offer.order.status !== 'PAYMENT_PENDING') {
         throw new Error(`This offer already has an order in progress (status: ${offer.order.status}). Ask the customer to request a fresh offer to restart checkout.`)
      }
      return offer.order
    }

    if (offer.expiresAt <= now) {
      await tx.offer.update({ where: { id: offer.id }, data: { status: 'EXPIRED' } })
      throw new Error('This offer has expired. Please ask for a fresh offer before checking out.')
    }

    // This is the authoritative spend reservation. It is inside the same
    // Serializable transaction that creates Order, so two tabs or agents
    // cannot overspend an account by racing past separate read checks.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await assertAccountSpendLimit(tx as unknown as any, offer.customerId, offer.merchantId, offer.total, now)

    if (offer.buyerIntent?.maximumAmount) {
      const pastOrders = await tx.order.findMany({
        where: { buyerIntentId: offer.buyerIntentId, status: { notIn: ['DRAFT', 'PAYMENT_FAILED', 'CANCELLED', 'EXPIRED'] } },
        select: { totalAmount: true },
      })
      const currentSpend = pastOrders.reduce((sum, order) => sum + order.totalAmount, 0)
      if (currentSpend + offer.total > offer.buyerIntent.maximumAmount) {
        throw new Error('Offer exceeds cumulative buyer budget')
      }
    }

    const shortItem = offer.items.find((item) => item.product.inventory < item.quantity)
    if (shortItem) {
      const failedOrder = await tx.order.create({
        data: {
          merchantId: offer.merchantId,
          customerId: offer.customerId,
          buyerIntentId: offer.buyerIntentId ?? undefined,
          offerId: offer.id,
          status: 'INVENTORY_FAILED',
          totalAmount: offer.total,
          currency: 'INR',
        },
      })
      await tx.auditLog.create({
        data: {
          merchantId: offer.merchantId,
          orderId: failedOrder.id,
          actorUserId: user.id,
          action: 'INVENTORY_CHECK_FAILED',
          status: 'REJECTED',
          reason: `${shortItem.product.name} has only ${shortItem.product.inventory} in stock, but ${shortItem.quantity} were offered.`,
          details: { offerId: offer.id, productId: shortItem.productId },
        },
      })
      throw new Error(`${shortItem.product.name} is no longer available in the requested quantity. Please ask for a fresh offer.`)
    }

    const newOrder = await tx.order.create({
      data: {
        merchantId: offer.merchantId,
        customerId: customer.id,
        buyerIntentId: offer.buyerIntentId,
        offerId: offer.id,
        totalAmount: offer.total,
        status: 'PAYMENT_PENDING',
        currency: 'INR',
        items: { create: offer.items.map((item) => ({ productId: item.productId, quantity: item.quantity, unitPrice: item.unitPrice })) },
        payment: { create: { amount: offer.total } },
      },
    })
    // We intentionally DO NOT modify the cart here!

    await tx.auditLog.create({ data: { merchantId: offer.merchantId, orderId: newOrder.id, actorUserId: user.id, action: 'ORDER_ACCEPTED', status: 'APPROVED', reason: 'Offer revalidated before payment', details: { offerId: offer.id } } })

    return newOrder
  }, { isolationLevel: 'Serializable' })

  // Outside the transaction, get/create the Razorpay order
  const rzpOrder = await createRazorpayOrder(order.id)
  return { internalOrderId: order.id, razorpayOrder: rzpOrder }
}
