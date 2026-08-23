import { z } from 'zod'
import { createOfferForCustomer } from '@/backend/actions/commerce'

const schema = z.object({ productIds: z.array(z.string().uuid()).min(1).max(10), discountPercentage: z.number().min(0).max(100).default(0), buyerIntentId: z.string().uuid().optional() })

export async function POST(request: Request) {
  try {
    const offer = await createOfferForCustomer(schema.parse(await request.json()))
    return Response.json({ offer })
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Offer blocked' }, { status: 400 })
  }
}
