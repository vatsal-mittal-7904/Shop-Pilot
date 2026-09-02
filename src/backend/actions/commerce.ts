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
  // Scopes the basket lookup to one merchant. Must be explicitly provided by the caller.
  merchantId: z.string().uuid(),
})

type PolicyMap = Record<string, number>

// Campaign configuration is merchant-authored data, so it must be validated
// again at the financial boundary. The chat prompt can help the model choose
// the right campaign, but it is never the authorization mechanism.
const recoveryCampaignEligibilitySchema = z.object({
  cartIds: z.array(z.string().min(1)).min(1).max(100),
  discountPercent: z.number().finite().min(0).max(100).optional(),
}).passthrough()

const clearanceCampaignEligibilitySchema = z.object({
  productId: z.string().min(1),
  customerIds: z.array(z.string().min(1)).min(1).max(100),
  discountPercent: z.number().finite().min(0).max(100).optional(),
}).passthrough()

type CartForCampaignEligibility = {
  id: string
  items: Array<{ productId: string; quantity: number }>
}

/**
 * Validates that a campaign is authorized for this exact customer selection.
 *
 * This deliberately lives beside offer creation rather than in the chat/tool
 * layer: any future route or server action that creates an offer receives the
 * same authorization boundary. A campaign ID alone is never a discount grant.
 */
function assertCampaignEligibleForCart({
  campaign,
  customerId,
  cart,
}: {
  campaign: { type: string; configuration: unknown }
  customerId: string
  cart: CartForCampaignEligibility
}) {
  if (campaign.type === 'RECOVERY') {
    const configuration = recoveryCampaignEligibilitySchema.safeParse(campaign.configuration)
    if (!configuration.success || !configuration.data.cartIds.includes(cart.id)) {
      throw new Error('This recovery campaign is not authorized for the selected basket.')
    }
    return
  }

  if (campaign.type === 'CLEARANCE') {
    const configuration = clearanceCampaignEligibilitySchema.safeParse(campaign.configuration)
    if (!configuration.success || !configuration.data.customerIds.includes(customerId)) {
      throw new Error('This clearance campaign is not authorized for this customer.')
    }

    // Clearance campaigns issue a discount for one pre-approved SKU, not a
    // blanket discount for every line a shopper happens to put in their cart.
    const [item] = cart.items
    if (cart.items.length !== 1 || item.productId !== configuration.data.productId || item.quantity !== 1) {
      throw new Error('This clearance campaign is only authorized for its designated product.')
    }
    return
  }

  throw new Error('This campaign type is not authorized for customer checkout offers.')
}

export async function policyMap(merchantId: string): Promise<PolicyMap> {
  const policies = await prisma.merchantPolicy.findMany({ where: { merchantId } })
  return Object.fromEntries(policies.map((policy) => [policy.key, policy.value]))
}

const activeCartInclude = { items: { include: { product: true } } } as const

/**
 * Resolves the one basket a request is about.
 *
 * `merchantId` is strictly required to ensure the cart is scoped to a single merchant.
 */
async function resolveActiveCart(customerId: string, merchantId: string) {
  return prisma.cart.findFirst({
    where: { customerId, merchantId, status: 'ACTIVE' },
    include: activeCartInclude,
    orderBy: { updatedAt: 'desc' },
  })
}

export async function getActiveCart(merchantId: string) {
  const { customer } = await requireCustomer()
  const parsedMerchantId = z.string().uuid().parse(merchantId)
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

  // Separate discount ceiling from discount authorization:
  // Any discount > 0 must be authorized by an approved Campaign belonging to
  // this merchant. The ceiling (MAX_DISCOUNT_PERCENTAGE) enforces the maximum limit,
  // but does not grant discounts on its own.
  if (data.campaignId) {
    const campaign = await prisma.campaign.findFirst({
      where: { id: data.campaignId, merchantId, status: 'APPROVED' },
    })
    if (!campaign) {
      throw new Error('That campaign is not an approved campaign for this merchant.')
    }
    assertCampaignEligibleForCart({ campaign, customerId: customer.id, cart })
    const config = campaign.configuration as Record<string, unknown> | null
    const authorizedDiscount = campaign.discountPercent ?? (typeof config?.discountPercent === 'number' ? config.discountPercent : 0)
    if (data.discountPercentage > authorizedDiscount) {
      throw new Error(`Discount of ${data.discountPercentage}% exceeds the authorized campaign discount of ${authorizedDiscount}%.`)
    }
  } else if (data.discountPercentage > 0) {
    throw new Error('Discounts are not authorized without an approved campaign.')
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
  await assertAccountSpendLimit(prisma, customer.id, merchantId, total)

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
