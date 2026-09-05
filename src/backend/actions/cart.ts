'use server'

import { z } from 'zod'
import { prisma } from '@/backend/db/prisma'
import { requireCustomer } from '@/backend/auth/session'
import { checkDistributedRateLimit } from '@/backend/utils/rateLimit'

const productIdSchema = z.string().uuid()

const addToCartSchema = z.object({
  customerId: z.string().uuid(),
  merchantId: z.string().uuid(),
  productId: z.string().uuid(),
})

/**
 * The single cart-write implementation for the whole app.
 *
 * Every basket mutation funnels through here so there is exactly one place
 * that holds the invariants. Previously a second, weaker copy lived in
 * commerce.ts (`addProductToCart`) with no row lock and no inventory ceiling,
 * and it was the one wired to the agent UI and /api/agent/cart -- so the
 * hardened path was the one almost nothing called.
 *
 * The merchant is always DERIVED from the product row, never taken from the
 * caller. A client-supplied merchantId can only ever be an assertion that we
 * check and reject on mismatch; it can never widen what gets written.
 */
async function addOneUnitToCart({
  productId,
  expectedCustomerId,
  expectedMerchantId,
}: {
  productId: string
  expectedCustomerId?: string
  expectedMerchantId?: string
}) {
  const { customer } = await requireCustomer()

  const rateLimit = await checkDistributedRateLimit(`customer:cart:${customer.id}`, {
    maxRequests: 30,
    windowMs: 60_000,
  })
  if (!rateLimit.allowed) {
    throw new Error('Rate limit exceeded for basket updates. Please wait a moment.')
  }

  const parsedProductId = productIdSchema.parse(productId)

  // `expectedCustomerId` exists because one caller is a client component that
  // already holds the id. It is never trusted on its own: the session is
  // re-resolved above and must match, or we reject.
  if (expectedCustomerId && expectedCustomerId !== customer.id) {
    throw new Error("You cannot modify another customer's cart")
  }

  const product = await prisma.product.findUnique({
    where: { id: parsedProductId },
    select: { id: true, merchantId: true, inventory: true },
  })
  if (!product) throw new Error('That product is no longer available')
  if (expectedMerchantId && expectedMerchantId !== product.merchantId) {
    throw new Error('This product is not available from this merchant')
  }
  if (product.inventory < 1) throw new Error('This product is out of stock')

  // Authoritative: the product's own merchant, so a cart can never mix
  // merchants and an offer built from it can never span two catalogues.
  const merchantId = product.merchantId

  return prisma.$transaction(async (tx) => {
    // Exclusive row lock on the customer serializes concurrent adds (double
    // clicks, or the agent and the shopper clicking at once). It forces the
    // second request to observe the cart the first one created instead of
    // creating a duplicate, and it serializes the inventory ceiling check
    // below so two adds cannot both read the same pre-increment quantity.
    await tx.$executeRaw`SELECT 1 FROM "Customer" WHERE id = ${customer.id} FOR UPDATE`

    // SEAMLESS MULTI-TENANT COMMERCE:
    // Automatically abandon any ACTIVE carts the customer has with OTHER merchants.
    // This allows the shopper to seamlessly transition between stores without
    // rigid single-tenant blocking and without waiting for the background sweeper.
    await tx.cart.updateMany({
      where: {
        customerId: customer.id,
        merchantId: { not: merchantId },
        status: 'ACTIVE',
      },
      data: { status: 'ABANDONED' }
    })

    // Re-read inventory inside the lock: the pre-flight check above raced.
    const locked = await tx.product.findUnique({
      where: { id: parsedProductId },
      select: { inventory: true },
    })
    if (!locked || locked.inventory < 1) throw new Error('This product is out of stock')

    const cart =
      (await tx.cart.findFirst({
        where: { customerId: customer.id, merchantId, status: 'ACTIVE' },
        orderBy: { updatedAt: 'desc' },
      })) ?? (await tx.cart.create({ data: { customerId: customer.id, merchantId } }))

    const existingItem = await tx.cartItem.findUnique({
      where: { cartId_productId: { cartId: cart.id, productId: parsedProductId } },
    })

    if (existingItem) {
      if (existingItem.quantity + 1 > locked.inventory) {
        throw new Error('Cannot add more of this product than is in stock')
      }
      await tx.cartItem.update({
        where: { id: existingItem.id },
        data: { quantity: existingItem.quantity + 1 },
      })
    } else {
      await tx.cartItem.create({
        data: { cartId: cart.id, productId: parsedProductId, quantity: 1 },
      })
    }

    // Touch the cart so `orderBy: { updatedAt: 'desc' }` on the read path
    // reflects the most recently used basket. Writing CartItem rows does not
    // bump the parent Cart's @updatedAt on its own. Setting status to the
    // value it already holds is an idempotent way to trigger it.
    await tx.cart.update({ where: { id: cart.id }, data: { status: 'ACTIVE' } })

    return tx.cart.findUniqueOrThrow({
      where: { id: cart.id },
      include: { items: { include: { product: true } } },
    })
  })
}

/**
 * Adds one unit of `productId` to the caller's ACTIVE cart, resolving the
 * merchant from the product. This is the preferred entry point: it takes no
 * caller-supplied identity or merchant at all.
 *
 * Returns the full active cart (with items) because the agent UI and
 * /api/agent/cart render it directly.
 */
export async function addProductToCart(productId: string) {
  return addOneUnitToCart({ productId })
}

/**
 * Client-component entry point, kept for `ProductCards`, which already holds
 * both ids. Both are validated as assertions against the session and the
 * product row rather than being used to select what gets written.
 */
export async function addToCart(customerId: string, merchantId: string, productId: string) {
  const data = addToCartSchema.parse({ customerId, merchantId, productId })
  const cart = await addOneUnitToCart({
    productId: data.productId,
    expectedCustomerId: data.customerId,
    expectedMerchantId: data.merchantId,
  })
  const item = cart.items.find((cartItem) => cartItem.productId === data.productId)
  if (!item) throw new Error('The basket could not be updated. Please try again.')
  return { cartId: cart.id, productId: item.productId, quantity: item.quantity }
}

/**
 * Empties all items from the customer's active basket.
 */
export async function clearCart() {
  const { customer } = await requireCustomer()
  return prisma.$transaction(async (tx) => {
    const cart = await tx.cart.findFirst({
      where: { customerId: customer.id, status: 'ACTIVE' },
      orderBy: { updatedAt: 'desc' },
    })
    if (!cart) return { success: true, count: 0 }
    const result = await tx.cartItem.deleteMany({
      where: { cartId: cart.id },
    })
    return { success: true, count: result.count }
  })
}

