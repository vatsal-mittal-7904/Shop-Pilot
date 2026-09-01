'use server'

import { z } from 'zod'
import { prisma } from '@/backend/db/prisma'
import { requireCustomer } from '@/backend/auth/session'
import { cartSelectionBinding } from '@/backend/utils/cartSelectionBinding'
import { assertAccountSpendLimit } from '@/backend/actions/accountBudget'

const offerInputSchema = z.object({
  discountPercentage: z.number().finite().min(0).max(100).default(0),
  buyerIntentId: z.string().uuid().optional(),
  campaignId: z.string().uuid().optional(),
  // Scopes the basket lookup to one merchant. Optional so autonomous-agent
  // callers that only hold a session can still transact, but supplying it is
  // strongly preferred -- see resolveActiveCart for what happens without it.
  merchantId: z.string().uuid().optional(),
})

type PolicyMap = Record<string, number>

export async function policyMap(merchantId: string): Promise<PolicyMap> {
  const policies = await prisma.merchantPolicy.findMany({ where: { merchantId } })
  return Object.fromEntries(policies.map((policy) => [policy.key, policy.value]))
}

const activeCartInclude = { items: { include: { product: true } } } as const

/**
 * Resolves the one basket a request is about.
 *
 * When `merchantId` is supplied the query is scoped to it, which is the only
 * way to be certain which catalogue the resulting offer prices against.
 *
 * When it is not supplied we refuse to guess. The previous behaviour was
 * `findFirst({ customerId, status: 'ACTIVE' }, orderBy: updatedAt desc)`, which
 * silently returned whichever basket happened to be touched last -- so a
 * shopper with an active basket at two merchants could add to one and be sold
 * the other. Falling back to "most recent" makes that a data-dependent bug
 * that only shows up under exactly the conditions nobody tests. Erroring is
 * recoverable; charging for the wrong basket is not.
 */
async function resolveActiveCart(customerId: string, merchantId?: string) {
  if (merchantId) {
    return prisma.cart.findFirst({
      where: { customerId, merchantId, status: 'ACTIVE' },
      include: activeCartInclude,
      orderBy: { updatedAt: 'desc' },
    })
  }

  const carts = await prisma.cart.findMany({
    where: { customerId, status: 'ACTIVE' },
    include: activeCartInclude,
    orderBy: { updatedAt: 'desc' },
    take: 2,
  })

  // Two ACTIVE carts at the same merchant is benign (historical rows, or a
  // race that predates the cart lock) -- the newest wins. Two at *different*
  // merchants is genuinely ambiguous and must not be resolved by guessing.
  if (carts.length > 1 && carts[0].merchantId !== carts[1].merchantId) {
    throw new Error(
      'You have active baskets with more than one merchant. Reopen the storefront you want to check out from so the basket can be scoped to a single merchant.',
    )
  }

  return carts[0] ?? null
}

export async function getActiveCart(merchantId?: string) {
  const { customer } = await requireCustomer()
  const parsedMerchantId = merchantId ? z.string().uuid().parse(merchantId) : undefined
  return resolveActiveCart(customer.id, parsedMerchantId)
}

/**
 * Builds a checkout offer only from the authenticated shopper's persisted
 * basket. This is the boundary that prevents an LLM (or a crafted request)
 * from turning arbitrary catalog IDs into a payable offer.
 */
export async function createOfferFromActiveCart(input: z.input<typeof offerInputSchema>) {
  const { user, customer } = await requireCustomer()
  const data = offerInputSchema.parse(input)
  const cart = await resolveActiveCart(customer.id, data.merchantId)
  if (!cart?.items.length) throw new Error('Your basket is empty. Add a product yourself before requesting checkout.')
  if (cart.items.some((item) => item.quantity < 1 || item.product.merchantId !== cart.merchantId)) {
    throw new Error('Your basket has an invalid merchant selection. Please refresh and select products again.')
  }
  if (cart.items.some((item) => item.product.inventory < item.quantity)) throw new Error('An item in your basket is out of stock')

  // Authoritative merchant: the basket's own, not the caller's claim.
  const merchantId = cart.merchantId

  // `campaignId` arrives from the caller (the chat tool passes through a value
  // the model produced). It grants nothing on its own, but it is persisted on
  // the Offer and downstream code reads it, so it has to be a real APPROVED
  // campaign belonging to THIS merchant. Without this check any valid campaign
  // UUID could be stapled to any offer.
  if (data.campaignId) {
    const campaign = await prisma.campaign.findFirst({
      where: { id: data.campaignId, merchantId, status: 'APPROVED' },
      select: { id: true },
    })
    if (!campaign) {
      throw new Error('That campaign is not an approved campaign for this merchant.')
    }
  }

  const policies = await policyMap(merchantId)
  const maxDiscount = policies.MAX_DISCOUNT_PERCENTAGE ?? 0
  if (data.discountPercentage > maxDiscount) throw new Error(`Discount exceeds the ${maxDiscount}% merchant limit`)

  const subtotal = cart.items.reduce((sum, item) => sum + item.product.price * item.quantity, 0)
  const discount = Math.floor(subtotal * (data.discountPercentage / 100))
  const total = subtotal - discount
  const cost = cart.items.reduce((sum, item) => sum + item.product.cost * item.quantity, 0)
  const marginPercent = total > 0 ? ((total - cost) / total) * 100 : -Infinity
  if (marginPercent < (policies.MIN_MARGIN_PERCENTAGE ?? 0)) {
    throw new Error('Offer would violate the minimum merchant margin')
  }

  // Early, buyer-friendly forecast. The definitive reservation is repeated in
  // createOrReuseCheckoutOrder inside its serializable transaction.
  await assertAccountSpendLimit(prisma, customer.id, total)

  const intent = data.buyerIntentId
    ? await prisma.buyerIntent.findFirst({ where: { id: data.buyerIntentId, customerId: customer.id } })
    // Intent refinements update the existing row, so createdAt is not a
    // reliable indicator of the currently active budget.
    : await prisma.buyerIntent.findFirst({ where: { customerId: customer.id }, orderBy: { updatedAt: 'desc' } })
  if (intent?.maximumAmount) {
    const pastOrders = await prisma.order.findMany({
      where: { buyerIntentId: intent.id, status: { notIn: ['DRAFT', 'PAYMENT_FAILED', 'CANCELLED', 'EXPIRED'] } },
      select: { totalAmount: true },
    })
    const currentSpend = pastOrders.reduce((sum, order) => sum + order.totalAmount, 0)
    if (currentSpend + total > intent.maximumAmount) {
      throw new Error('Offer exceeds the cumulative buyer intent budget')
    }
  }
  if (intent?.autonomousPurchase && total > (policies.MAX_AUTONOMOUS_SPEND ?? 0)) {
    throw new Error('Offer exceeds the merchant autonomous-payment limit')
  }

  const offerItems = cart.items.map((item) => ({
    productId: item.productId,
    quantity: item.quantity,
    unitPrice: item.product.price - Math.floor(item.product.price * (data.discountPercentage / 100)),
  }))
  const cartSnapshotHash = cartSelectionBinding({
    customerId: customer.id,
    merchantId,
    cartId: cart.id,
    items: offerItems,
  })
  const offer = await prisma.offer.create({
    data: {
      merchantId,
      customerId: customer.id,
      buyerIntentId: intent?.id,
      cartId: cart.id,
      campaignId: data.campaignId,
      cartSnapshotHash,
      subtotal,
      discount,
      total,
      discountPercent: data.discountPercentage,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      items: { create: offerItems },
    },
    include: { items: { include: { product: true } } },
  })
  await prisma.auditLog.create({
    data: {
      merchantId,
      actorUserId: user.id,
      action: 'OFFER_CREATED',
      status: 'APPROVED',
      reason: 'Customer-selected cart, buyer intent, inventory, discount, and margin checks passed',
      details: { offerId: offer.id, cartId: cart.id, discountPercent: data.discountPercentage, marginPercent, cartBinding: 'HMAC-SHA256' },
    },
  })
  return offer
}
