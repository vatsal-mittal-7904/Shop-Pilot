import { z } from 'zod'
import { addProductToCart } from '@/backend/actions/cart'

const schema = z.object({ productId: z.string().uuid() }).strict()

/** Customer API surface for an explicit basket selection. */
export async function POST(request: Request) {
  try {
    const cart = await addProductToCart(schema.parse(await request.json()).productId)
    return Response.json({ cart })
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Could not update basket' }, { status: 400 })
  }
}
