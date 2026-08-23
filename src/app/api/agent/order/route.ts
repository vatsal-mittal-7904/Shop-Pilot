import { z } from 'zod'
import { startCheckout } from '@/backend/actions/payment'

const schema = z.object({ offerId: z.string().uuid() })

export async function POST(request: Request) {
  try {
    const checkout = await startCheckout(schema.parse(await request.json()).offerId)
    return Response.json(checkout)
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Order could not be created' }, { status: 400 })
  }
}
