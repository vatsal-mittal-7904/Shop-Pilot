import { z } from 'zod'
import { prisma } from '@/backend/db/prisma'

const schema = z.object({ query: z.string().trim().min(1).max(100) })

export async function POST(request: Request) {
  const { query } = schema.parse(await request.json())
  const merchant = await prisma.merchant.findFirst({ orderBy: { createdAt: 'asc' } })
  if (!merchant) return Response.json({ error: 'Merchant unavailable' }, { status: 503 })
  const products = await prisma.product.findMany({
    where: { merchantId: merchant.id, inventory: { gt: 0 }, OR: [{ name: { contains: query, mode: 'insensitive' } }, { category: { contains: query, mode: 'insensitive' } }, { tags: { has: query.toLowerCase() } }] },
    take: 12,
  })
  return Response.json({ products })
}
