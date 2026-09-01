import { prisma } from '@/backend/db/prisma'
import { requireCustomer } from '@/backend/auth/session'
import { checkRateLimit } from '@/backend/utils/rateLimit'

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

export async function GET() {
  let customerId: string
  try {
    ({ customer: { id: customerId } } = await requireCustomer())
  } catch {
    return Response.json({ error: 'Customer authentication required' }, { status: 401 })
  }

  const rateLimit = checkRateLimit(`agent-catalog:${customerId}`)
  if (!rateLimit.allowed) {
    return Response.json(
      { error: 'Rate limit exceeded. Please wait a moment.' },
      { status: 429, headers: { 'Retry-After': Math.ceil(rateLimit.retryAfterMs / 1000).toString() } },
    )
  }

  const merchant = await prisma.merchant.findFirst({ orderBy: { createdAt: 'asc' } })
  if (!merchant) return Response.json({ error: 'Merchant unavailable' }, { status: 503 })
  const products = await prisma.product.findMany({
    where: { merchantId: merchant.id, inventory: { gt: 0 } },
    // Never return merchant cost or internal stock-management fields from a
    // buyer-facing endpoint. This is an explicit allow-list, not a default row.
    select: catalogProductSelect,
  })
  return Response.json({ merchant: { id: merchant.id, name: merchant.name }, products })
}
