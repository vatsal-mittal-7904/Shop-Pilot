import { z } from 'zod'
import { prisma } from '@/backend/db/prisma'
import { requireCustomer } from '@/backend/auth/session'
import { checkDistributedRateLimit } from '@/backend/utils/rateLimit'

const catalogProductSelect = {
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
  relatedProducts: true,
  complementaryProducts: true,
  upgradeProducts: true,
} as const

const merchantIdSchema = z.string().uuid()

export async function GET(request: Request) {
  let customerId: string
  try {
    ({ customer: { id: customerId } } = await requireCustomer())
  } catch {
    return Response.json({ error: 'Customer authentication required' }, { status: 401 })
  }

  const rateLimit = await checkDistributedRateLimit(`agent-catalog:${customerId}`)
  if (!rateLimit.allowed) {
    return Response.json(
      { error: 'Rate limit exceeded. Please wait a moment.' },
      { status: 429, headers: { 'Retry-After': Math.ceil(rateLimit.retryAfterMs / 1000).toString() } },
    )
  }

  const url = new URL(request.url)
  const requestedMerchantId = url.searchParams.get('merchantId') || request.headers.get('x-merchant-id')

  let merchantId: string
  if (requestedMerchantId) {
    const parsed = merchantIdSchema.safeParse(requestedMerchantId)
    if (!parsed.success) {
      return Response.json({ error: 'Invalid merchant ID format' }, { status: 400 })
    }
    merchantId = parsed.data
  } else {
    // If no merchantId provided, check if there's only 1 merchant in the system
    const merchants = await prisma.merchant.findMany({ select: { id: true }, take: 2 })
    if (merchants.length > 1) {
      return Response.json(
        { error: 'Merchant context is required when multiple merchants exist. Pass ?merchantId=<uuid>.' },
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
    where: { merchantId: merchant.id, inventory: { gt: 0 } },
    // Never return merchant cost or internal stock-management fields from a
    // buyer-facing endpoint. This is an explicit allow-list, not a default row.
    select: catalogProductSelect,
  })
  return Response.json({ merchant: { id: merchant.id, name: merchant.name }, products })
}

