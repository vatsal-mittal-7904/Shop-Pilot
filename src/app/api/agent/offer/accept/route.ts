import { z } from 'zod'
import { acceptOfferForCheckout } from '@/backend/actions/order'

const schema = z.object({ offerId: z.string().uuid() })

export async function POST(request: Request) {
  try {
    const acceptance = await acceptOfferForCheckout(schema.parse(await request.json()).offerId)
    return Response.json({ acceptance })
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Offer could not be accepted' }, { status: 400 })
  }
}
