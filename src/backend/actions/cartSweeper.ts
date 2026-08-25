import { prisma } from '@/backend/db/prisma'

// Deliberately NOT a `'use server'` module, unlike its siblings in this
// directory: it takes merchantId as a caller-supplied argument with no
// session check, so exposing it as a client-callable server action would let
// any browser trigger a cart-abandonment sweep for an arbitrary merchant on
// demand. Server-side callers only -- the cron route
// (src/app/api/cron/sweep-carts/route.ts), or runCartSweeper() in merchant.ts,
// which resolves merchantId from the authenticated session before calling in.

const ABANDONED_CART_POLICY_KEY = 'ABANDONED_CART_MINUTES'
const DEFAULT_ABANDONED_CART_MINUTES = 30

export type MarkAbandonedCartsResult = {
  merchantId: string
  thresholdMinutes: number
  cutoff: Date
  updatedCount: number
}

/**
 * Marks any of `merchantId`'s ACTIVE carts as ABANDONED once they've gone
 * untouched longer than the merchant's ABANDONED_CART_MINUTES policy (falling
 * back to 30 minutes only when that policy row doesn't exist at all).
 *
 * This is the only writer of Cart.status = ABANDONED outside prisma/seed-demo.ts,
 * and therefore the sole producer of the input that the abandoned-cart branch of
 * opportunitiesForMerchant() (merchant.ts) consumes.
 */
export async function markAbandonedCarts(merchantId: string): Promise<MarkAbandonedCartsResult> {
  const policy = await prisma.merchantPolicy.findUnique({
    where: { merchantId_key: { merchantId, key: ABANDONED_CART_POLICY_KEY } },
  })
  const thresholdMinutes = policy?.value ?? DEFAULT_ABANDONED_CART_MINUTES
  const cutoff = new Date(Date.now() - thresholdMinutes * 60 * 1000)

  const { count } = await prisma.cart.updateMany({
    where: {
      merchantId,
      status: 'ACTIVE',
      updatedAt: { lt: cutoff },
    },
    data: { status: 'ABANDONED' },
  })

  return { merchantId, thresholdMinutes, cutoff, updatedCount: count }
}
