import { afterAll, describe, expect, test, vi } from 'vitest'
import { prisma } from '@/backend/db/prisma'
import { approveCampaign } from '@/backend/actions/merchant'

afterAll(async () => {
  await prisma.$disconnect()
})

async function merchantContext() {
  const user = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@technest.com' } })
  const merchant = await prisma.merchant.findUniqueOrThrow({ where: { ownerId: user.id } })
  return { user, merchant }
}

vi.mock('@/backend/auth/session', () => ({ requireMerchant: merchantContext }))

describe('clearance campaign dispatch', () => {
  test('approval creates a bounded, customer-specific clearance offer', async () => {
    const { merchant } = await merchantContext()
    const recipient = await prisma.customer.findFirstOrThrow({
      where: { orders: { some: { merchantId: merchant.id, status: 'PAID' } } },
      select: { id: true },
    })
    const product = await prisma.product.create({
      data: {
        merchantId: merchant.id,
        name: `Clearance test product ${Date.now()}`,
        category: 'Testing',
        price: 100_000,
        cost: 50_000,
        inventory: 50,
        attributes: {},
      },
    })
    const campaign = await prisma.campaign.create({
      data: {
        merchantId: merchant.id,
        type: 'CLEARANCE',
        title: 'Test clearance dispatch',
        rationale: 'High inventory test SKU with a deterministic eligible recipient.',
        estimatedImpact: product.price,
        budget: 10_000,
        discountPercent: 10,
        status: 'PROPOSED',
        configuration: { productId: product.id, customerIds: [recipient.id], discountPercent: 10 },
      },
    })

    await expect(approveCampaign(campaign.id)).resolves.toMatchObject({ status: 'COMPLETED' })

    const offer = await prisma.offer.findFirst({
      where: { campaignId: campaign.id, customerId: recipient.id },
      include: { items: true },
    })
    expect(offer).toMatchObject({
      status: 'ACTIVE',
      subtotal: 100_000,
      discount: 10_000,
      total: 90_000,
      items: [{ productId: product.id, quantity: 1, unitPrice: 90_000 }],
    })
    expect(offer?.expiresAt.getTime()).toBeGreaterThan(Date.now())
  })
})
