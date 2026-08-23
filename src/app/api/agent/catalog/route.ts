import { prisma } from '@/backend/db/prisma'

export async function GET() {
  const merchant = await prisma.merchant.findFirst({ orderBy: { createdAt: 'asc' } })
  if (!merchant) return Response.json({ error: 'Merchant unavailable' }, { status: 503 })
  const products = await prisma.product.findMany({
    where: { merchantId: merchant.id, inventory: { gt: 0 } },
    select: { id: true, name: true, category: true, price: true, inventory: true, attributes: true, imageUrl: true, warrantyYears: true, deliveryDays: true, tags: true, relatedProducts: true },
  })
  return Response.json({ merchant: { id: merchant.id, name: merchant.name }, products })
}
