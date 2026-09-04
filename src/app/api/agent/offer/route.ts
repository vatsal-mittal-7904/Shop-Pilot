import { z } from 'zod'
import { createOfferFromActiveCart } from '@/backend/actions/commerce'

const schema = z
  .object({
    discountPercentage: z.number().min(0).max(100).default(0),
    buyerIntentId: z.string().uuid().optional(),
    // Scopes the basket lookup. `.strict()` still refuses `campaignId`: a
    // buyer-facing endpoint has no business attaching a campaign to an offer.
    merchantId: z.string().uuid().optional(),
  })
  .strict()

import { prisma } from '@/backend/db/prisma'
import { requireCustomer } from '@/backend/auth/session'

export async function POST(request: Request) {
  try {
    const { discountPercentage, merchantId, buyerIntentId } = schema.parse(await request.json())
    let resolvedMerchantId = merchantId
    if (!resolvedMerchantId) {
      const { customer } = await requireCustomer()
      const activeCart = await prisma.cart.findFirst({
        where: { customerId: customer.id, status: 'ACTIVE' },
        orderBy: { updatedAt: 'desc' },
        select: { merchantId: true },
      })
      if (activeCart) {
        resolvedMerchantId = activeCart.merchantId
      }
    }
    if (!resolvedMerchantId) return Response.json({ error: 'merchantId is strictly required.' }, { status: 400 })
    const offer = await createOfferFromActiveCart({ discountPercentage, merchantId: resolvedMerchantId, buyerIntentId })
    return Response.json({ offer })
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Offer blocked' }, { status: 400 })
  }
}
