import { z } from 'zod'
import { prisma } from '@/backend/db/prisma'
import { requireCustomer } from '@/backend/auth/session'
import { checkRateLimit } from '@/backend/utils/rateLimit'

const schema = z.object({
  query: z.string().trim().min(1).max(100),
  merchantId: z.string().uuid().optional(),
})

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

  let body: { query: string; merchantId?: string }
  try {
    body = schema.parse(await request.json())
  } catch {
    return Response.json({ error: 'A search query is required' }, { status: 400 })
  }

  const url = new URL(request.url)
  const requestedMerchantId = body.merchantId || url.searchParams.get('merchantId') || request.headers.get('x-merchant-id')

  let merchantId: string
  if (requestedMerchantId) {
    const parsed = z.string().uuid().safeParse(requestedMerchantId)
    if (!parsed.success) {
      return Response.json({ error: 'Invalid merchant ID format' }, { status: 400 })
    }
    merchantId = parsed.data
  } else {
    const merchants = await prisma.merchant.findMany({ select: { id: true }, take: 2 })
    if (merchants.length > 1) {
      return Response.json(
        { error: 'Merchant context is required when multiple merchants exist. Pass merchantId.' },
        { status: 400 },
      )
    }
    if (merchants.length === 0) {
      return Response.json({ error: 'Merchant unavailable' }, { status: 503 })
    }
    merchantId = merchants[0].id
  }

  const merchant = await prisma.merchant.findUnique({ where: { id: merchantId } })
  if (!merchant) return Response.json({ error: 'Merchant unavailable' }, { status: 404 })

  const products = await prisma.product.findMany({
    where: {
      merchantId: merchant.id,
      inventory: { gt: 0 },
      OR: [
        { name: { contains: body.query, mode: 'insensitive' } },
        { category: { contains: body.query, mode: 'insensitive' } },
        { tags: { has: body.query.toLowerCase() } },
      ],
    },
    take: 12,
    // Keep the search response buyer-safe; Product.cost is merchant-only.
    select: searchProductSelect,
  })
  return Response.json({ merchant: { id: merchant.id, name: merchant.name }, products })
}

