'use server'

import { z } from 'zod'
import { prisma } from '@/backend/db/prisma'
import { requireCustomer } from '@/backend/auth/session'

const addToCartSchema = z.object({
  customerId: z.string().uuid(),
  merchantId: z.string().uuid(),
  productId: z.string().uuid(),
})

/**
 * Adds one unit of `productId` to the caller's ACTIVE cart for `merchantId`,
 * creating the cart if none exists. Safe to call repeatedly for the same
 * product: relies on the CartItem @@unique([cartId, productId]) constraint
 * via upsert, so it increments quantity instead of throwing or duplicating rows.
 */
export async function addToCart(customerId: string, merchantId: string, productId: string) {
  // `customerId` is a parameter because this is invoked directly from a
  // client component, but it is never trusted on its own -- the caller is
  // re-resolved from the session and must match, or we reject. This keeps
  // the requested signature while preventing one customer's client from
  // modifying another customer's cart.
  const { customer } = await requireCustomer()
  const data = addToCartSchema.parse({ customerId, merchantId, productId })
  if (data.customerId !== customer.id) {
    throw new Error("You cannot modify another customer's cart")
  }

  const product = await prisma.product.findFirst({
    where: { id: data.productId, merchantId: data.merchantId },
  })
  if (!product) throw new Error('This product is not available from this merchant')
  if (product.inventory < 1) throw new Error('This product is out of stock')

  const item = await prisma.$transaction(async (tx) => {
    // Acquire an exclusive row lock on the customer to serialize concurrent
    // addToCart requests (like double-clicks). This forces the second request
    // to wait for the first to finish, ensuring it correctly sees the newly
    // created Cart instead of creating a duplicate, and serializing the inventory check.
    await tx.$executeRaw`SELECT 1 FROM "Customer" WHERE id = ${data.customerId} FOR UPDATE`

    let cart = await tx.cart.findFirst({
      where: { customerId: data.customerId, merchantId: data.merchantId, status: 'ACTIVE' },
      orderBy: { updatedAt: 'desc' },
    })
    
    if (!cart) {
      cart = await tx.cart.create({
        data: { customerId: data.customerId, merchantId: data.merchantId },
      })
    }

    let cartItem = await tx.cartItem.findUnique({
      where: { cartId_productId: { cartId: cart.id, productId: data.productId } },
    })

    if (cartItem) {
      if (cartItem.quantity + 1 > product.inventory) {
        throw new Error('Cannot add more of this product than is in stock')
      }
      cartItem = await tx.cartItem.update({
        where: { id: cartItem.id },
        data: { quantity: cartItem.quantity + 1 },
      })
    } else {
      cartItem = await tx.cartItem.create({
        data: { cartId: cart.id, productId: data.productId, quantity: 1 },
      })
    }

    return cartItem
  })

  return { cartId: item.cartId, productId: item.productId, quantity: item.quantity }
}
