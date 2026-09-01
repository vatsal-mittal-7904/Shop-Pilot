import { z } from 'zod'
import { prisma } from '@/backend/db/prisma'
import { requireCustomer } from '@/backend/auth/session'
import { checkRateLimit } from '@/backend/utils/rateLimit'

const schema = z.object({ query: z.string().trim().min(1).max(100) })
const searchProductSelect = {
  id: true,
  name: true,
  category: true,
  price: true,
  inventory: true,
  attributes: true,
  imageUrl: true,
  warrantyYears: true,
  deliveryDays: true,
  tags: true,
} as const

export async function POST(request: Request) {
  let customerId: string
  try {
    ({ customer: { id: customerId } } = await requireCustomer())
  } catch {
    return Response.json({ error: 'Customer authentication required' }, { status: 401 })
  }

  const rateLimit = checkRateLimit(`agent-search:${customerId}`)
  if (!rateLimit.allowed) {
    return Response.json(
      { error: 'Rate limit exceeded. Please wait a moment.' },
      { status: 429, headers: { 'Retry-After': Math.ceil(rateLimit.retryAfterMs / 1000).toString() } },
    )
  }

  let query: string
  try {
    ({ query } = schema.parse(await request.json()))
  } catch {
    return Response.json({ error: 'A search query is required' }, { status: 400 })
  }

  const merchant = await prisma.merchant.findFirst({ orderBy: { createdAt: 'asc' } })
  if (!merchant) return Response.json({ error: 'Merchant unavailable' }, { status: 503 })
  const products = await prisma.product.findMany({
    where: { merchantId: merchant.id, inventory: { gt: 0 }, OR: [{ name: { contains: query, mode: 'insensitive' } }, { category: { contains: query, mode: 'insensitive' } }, { tags: { has: query.toLowerCase() } }] },
    take: 12,
    // Keep the search response buyer-safe; Product.cost is merchant-only.
    select: searchProductSelect,
  })
  return Response.json({ products })
}
