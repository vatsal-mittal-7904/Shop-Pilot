'use server'

import { z } from 'zod'
import { prisma } from '@/backend/db/prisma'
import { requireCustomer } from '@/backend/auth/session'

const productIdsSchema = z.array(z.string().uuid()).min(1).max(10)
const offerInputSchema = z.object({
  productIds: productIdsSchema,
  discountPercentage: z.number().finite().min(0).max(100).default(0),
  buyerIntentId: z.string().uuid().optional(),
})

type PolicyMap = Record<string, number>

export async function policyMap(merchantId: string): Promise<PolicyMap> {
  const policies = await prisma.merchantPolicy.findMany({ where: { merchantId } })
  return Object.fromEntries(policies.map((policy) => [policy.key, policy.value]))
}

function parseIntent(rawRequest: string) {
  const budget = rawRequest.match(/(?:under|below|budget(?:\s+of)?|₹|rs\.?|rupees?)\s*([\d,]+)/i)
  const maximumAmount = budget ? Math.round(Number(budget[1].replace(/,/g, '')) * 100) : null
  const categories = ['keyboard', 'mouse', 'headphones', 'monitor', 'webcam', 'accessory']
    .filter((category) => rawRequest.toLowerCase().includes(category))
  return {
    maximumAmount: Number.isFinite(maximumAmount) ? maximumAmount : null,
    category: categories,
    requirements: { raw: rawRequest },
    autonomousPurchase: /autonom(?:ous|ously)|buy it automatically|without asking/i.test(rawRequest),
  }
}

export async function captureBuyerIntent(rawRequest: string) {
  const { customer } = await requireCustomer()
  const parsed = parseIntent(rawRequest.trim())
  return prisma.buyerIntent.create({
    data: {
      customerId: customer.id,
      rawRequest: rawRequest.trim(),
      category: parsed.category,
      requirements: parsed.requirements,
      maximumAmount: parsed.maximumAmount,
      autonomousPurchase: parsed.autonomousPurchase,
      requiresConfirmation: !parsed.autonomousPurchase,
    },
  })
}

export async function searchProducts(query: string) {
  const normalized = z.string().trim().min(1).max(100).parse(query)
  return prisma.product.findMany({
    where: {
      OR: [
        { name: { contains: normalized, mode: 'insensitive' } },
        { category: { contains: normalized, mode: 'insensitive' } },
        { tags: { has: normalized.toLowerCase() } },
      ],
      inventory: { gt: 0 },
    },
    take: 12,
  })
}

export async function checkInventory(productId: string) {
  const product = await prisma.product.findUnique({ where: { id: z.string().uuid().parse(productId) }, select: { inventory: true } })
  return product?.inventory ?? 0
}

export async function getRelatedProducts(productId: string) {
  const product = await prisma.product.findUnique({ where: { id: z.string().uuid().parse(productId) } })
  if (!product?.relatedProducts.length) return []
  return prisma.product.findMany({ where: { id: { in: product.relatedProducts }, merchantId: product.merchantId } })
}

export async function addProductToCart(productId: string) {
  const { customer } = await requireCustomer()
  const product = await prisma.product.findUnique({ where: { id: z.string().uuid().parse(productId) } })
  if (!product || product.inventory < 1) throw new Error('That product is no longer available')

  const cart = await prisma.cart.findFirst({
    where: { customerId: customer.id, merchantId: product.merchantId, status: 'ACTIVE' },
    orderBy: { updatedAt: 'desc' },
  }) ?? await prisma.cart.create({ data: { customerId: customer.id, merchantId: product.merchantId } })

  await prisma.cartItem.upsert({
    where: { cartId_productId: { cartId: cart.id, productId: product.id } },
    update: { quantity: { increment: 1 } },
    create: { cartId: cart.id, productId: product.id },
  })
  return getActiveCart()
}

export async function getActiveCart() {
  const { customer } = await requireCustomer()
  return prisma.cart.findFirst({
    where: { customerId: customer.id, status: 'ACTIVE' },
    include: { items: { include: { product: true } } },
    orderBy: { updatedAt: 'desc' },
  })
}

export async function createOfferForCustomer(input: z.infer<typeof offerInputSchema>) {
  const { user, customer } = await requireCustomer()
  const data = offerInputSchema.parse(input)
  const products = await prisma.product.findMany({ where: { id: { in: data.productIds } } })
  const counts = data.productIds.reduce((acc, id) => { acc[id] = (acc[id] || 0) + 1; return acc; }, {} as Record<string, number>)
  if (products.length !== Object.keys(counts).length) throw new Error('One or more selected products do not exist')
  const merchantId = products[0]?.merchantId
  if (!merchantId || products.some((product) => product.merchantId !== merchantId)) {
    throw new Error('An offer can contain products from only one merchant')
  }
  if (products.some((product) => product.inventory < counts[product.id])) throw new Error('An item is out of stock')

  const policies = await policyMap(merchantId)
  const maxDiscount = policies.MAX_DISCOUNT_PERCENTAGE ?? 0
  if (data.discountPercentage > maxDiscount) throw new Error(`Discount exceeds the ${maxDiscount}% merchant limit`)

  const subtotal = products.reduce((sum, product) => sum + product.price * counts[product.id], 0)
  const discount = Math.floor(subtotal * (data.discountPercentage / 100))
  const total = subtotal - discount
  const cost = products.reduce((sum, product) => sum + product.cost * counts[product.id], 0)
  const marginPercent = total > 0 ? ((total - cost) / total) * 100 : -Infinity
  if (marginPercent < (policies.MIN_MARGIN_PERCENTAGE ?? 0)) {
    throw new Error('Offer would violate the minimum merchant margin')
  }

  const intent = data.buyerIntentId
    ? await prisma.buyerIntent.findFirst({ where: { id: data.buyerIntentId, customerId: customer.id } })
    : await prisma.buyerIntent.findFirst({ where: { customerId: customer.id }, orderBy: { createdAt: 'desc' } })
  if (intent?.maximumAmount) {
    const pastOrders = await prisma.order.aggregate({
      where: { buyerIntentId: intent.id, status: { notIn: ['DRAFT', 'PAYMENT_FAILED', 'CANCELLED', 'EXPIRED'] } },
      _sum: { totalAmount: true }
    })
    const currentSpend = pastOrders._sum.totalAmount || 0;
    if (currentSpend + total > intent.maximumAmount) {
      throw new Error('Offer exceeds the cumulative buyer intent budget')
    }
  }
  if (intent?.autonomousPurchase && total > (policies.MAX_AUTONOMOUS_SPEND ?? 0)) {
    throw new Error('Offer exceeds the merchant autonomous-payment limit')
  }

  const cart = await prisma.cart.findFirst({ where: { customerId: customer.id, merchantId, status: 'ACTIVE' }, orderBy: { updatedAt: 'desc' } })
  const offer = await prisma.offer.create({
    data: {
      merchantId,
      customerId: customer.id,
      buyerIntentId: intent?.id,
      cartId: cart?.id,
      subtotal,
      discount,
      total,
      discountPercent: data.discountPercentage,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      items: { create: products.map((product) => ({ productId: product.id, quantity: counts[product.id], unitPrice: product.price - Math.floor(product.price * (data.discountPercentage / 100)) })) },
    },
    include: { items: { include: { product: true } } },
  })
  await prisma.auditLog.create({
    data: {
      merchantId,
      actorUserId: user.id,
      action: 'OFFER_CREATED',
      status: 'APPROVED',
      reason: 'Catalog, buyer intent, inventory, discount, and margin checks passed',
      details: { offerId: offer.id, discountPercent: data.discountPercentage, marginPercent },
    },
  })
  return offer
}

export async function createOrderFromOffer(offerId: string) {
  const { user, customer } = await requireCustomer()
  const parsedOfferId = z.string().uuid().parse(offerId)
  return prisma.$transaction(async (tx) => {
    const offer = await tx.offer.findFirst({
      where: { id: parsedOfferId, customerId: customer.id },
      include: { items: { include: { product: true } }, buyerIntent: true, order: true },
    })
    if (!offer) throw new Error('Offer not found')
    if (offer.order) return offer.order
    if (offer.status !== 'ACTIVE' || offer.expiresAt <= new Date()) {
      await tx.offer.update({ where: { id: offer.id }, data: { status: 'EXPIRED' } })
      throw new Error('This offer has expired. Please ask the agent for a new offer.')
    }
    if (offer.buyerIntent?.maximumAmount) {
      const pastOrders = await tx.order.aggregate({
        where: { buyerIntentId: offer.buyerIntentId, status: { notIn: ['DRAFT', 'PAYMENT_FAILED', 'CANCELLED', 'EXPIRED'] } },
        _sum: { totalAmount: true }
      })
      const currentSpend = pastOrders._sum.totalAmount || 0;
      if (currentSpend + offer.total > offer.buyerIntent.maximumAmount) {
        throw new Error('Offer exceeds cumulative buyer budget')
      }
    }
    if (offer.items.some((item) => item.product.inventory < item.quantity)) throw new Error('An item is out of stock')

    const order = await tx.order.create({
      data: {
        merchantId: offer.merchantId,
        customerId: customer.id,
        buyerIntentId: offer.buyerIntentId,
        offerId: offer.id,
        totalAmount: offer.total,
        status: 'ACCEPTED',
        items: { create: offer.items.map((item) => ({ productId: item.productId, quantity: item.quantity, unitPrice: item.unitPrice })) },
        payment: { create: { amount: offer.total } },
      },
    })
    await tx.offer.update({ where: { id: offer.id }, data: { status: 'ACCEPTED' } })
    if (offer.cartId) {
      for (const offerItem of offer.items) {
        const cartItem = await tx.cartItem.findUnique({ where: { cartId_productId: { cartId: offer.cartId, productId: offerItem.productId } } })
        if (cartItem) {
          if (cartItem.quantity <= offerItem.quantity) {
            await tx.cartItem.delete({ where: { id: cartItem.id } })
          } else {
            await tx.cartItem.update({ where: { id: cartItem.id }, data: { quantity: { decrement: offerItem.quantity } } })
          }
        }
      }
      const remainingItems = await tx.cartItem.count({ where: { cartId: offer.cartId } })
      if (remainingItems === 0) {
        await tx.cart.update({ where: { id: offer.cartId }, data: { status: 'CONVERTED' } })
      }
    }
    await tx.auditLog.create({ data: { merchantId: offer.merchantId, orderId: order.id, actorUserId: user.id, action: 'ORDER_ACCEPTED', status: 'APPROVED', reason: 'Offer revalidated before payment', details: { offerId: offer.id } } })
    return order
  }, { isolationLevel: 'Serializable' })
}

// Compatibility wrappers for the old manual testing screen. New buyer flows use persisted offers.
export async function proposeOffer(_merchantId: string, productIds: string[], requestedDiscountPct = 0) {
  try {
    const offer = await createOfferForCustomer({ productIds, discountPercentage: requestedDiscountPct })
    return { status: 'APPROVED' as const, offer: { items: offer.items.map((item) => ({ productId: item.productId, price: item.unitPrice })), subtotal: offer.subtotal, discount: offer.discount, total: offer.total, profit: 0 } }
  } catch (error) {
    return { status: 'BLOCKED' as const, reason: error instanceof Error ? error.message : 'Offer blocked', offer: null }
  }
}

export async function createInternalOrder(_merchantId: string, _items: { productId: string; quantity: string; price: number }[]): Promise<{ id: string; status: string }> {
  void _merchantId
  void _items
  throw new Error('Orders must be created from a server-persisted offer')
}
