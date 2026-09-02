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

export async function POST(request: Request) {
  try {
    const { discountPercentage, merchantId, buyerIntentId } = schema.parse(await request.json())
    if (!merchantId) return Response.json({ error: 'merchantId is strictly required.' }, { status: 400 })
    const offer = await createOfferFromActiveCart({ discountPercentage, merchantId, buyerIntentId })
    return Response.json({ offer })
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Offer blocked' }, { status: 400 })
  }
}
