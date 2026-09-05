import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  orderFindMany: vi.fn(),
  productFindUnique: vi.fn(),
  productFindMany: vi.fn(),
}))

vi.mock('@/backend/db/prisma', () => ({
  prisma: {
    order: { findMany: mocks.orderFindMany },
    product: {
      findUnique: mocks.productFindUnique,
      findMany: mocks.productFindMany,
    },
  },
}))

import {
  findIntelligentCrossSellCandidate,
  findIntelligentUpsellCandidate,
} from '@/backend/ai/recommendationIntelligence'
import { Product } from '@prisma/client'

describe('Dynamic Category-Agnostic Recommendation Intelligence', () => {
  const merchantId = 'merchant-universal-store'

  const coffeeBeans: Product = {
    id: 'prod-coffee-1',
    merchantId,
    name: 'Artisan Dark Roast 1kg',
    description: 'Whole bean specialty coffee',
    price: 150000, // ₹1,500
    cost: 70000,
    inventory: 20,
    category: 'coffee', // Not in COMPLEMENTARY_CATEGORY_MAP
    tags: ['beverage', 'specialty'],
    complementaryProducts: [],
    upgradeProducts: [],
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  }

  const coffeeFilters: Product = {
    id: 'prod-filters-1',
    merchantId,
    name: 'Unbleached Paper Filters (100pk)',
    description: 'Cone coffee filters',
    price: 35000, // ₹350 (23.3% of parent item, ideal cross-sell ratio)
    cost: 10000, // 71% gross margin
    inventory: 50,
    category: 'brewing-supplies',
    tags: ['filter', 'paper', 'addon'],
    complementaryProducts: [],
    upgradeProducts: [],
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  }

  const premiumCoffee: Product = {
    id: 'prod-coffee-reserve',
    merchantId,
    name: 'Geisha Single Origin 1kg',
    description: 'Ultra-rare micro-lot reserve',
    price: 260000, // ₹2,600 (1.73x upgrade)
    cost: 110000,
    inventory: 10,
    category: 'coffee',
    tags: ['beverage', 'specialty', 'reserve'],
    complementaryProducts: [],
    upgradeProducts: [],
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.orderFindMany.mockResolvedValue([])
    mocks.productFindUnique.mockResolvedValue(null)
    mocks.productFindMany.mockResolvedValue([])
  })

  it('discovers cross-sell add-on for unmapped categories via price bracket fallback', async () => {
    // Return filters via the dynamic query
    mocks.productFindMany.mockResolvedValue([coffeeFilters])

    const candidate = await findIntelligentCrossSellCandidate(
      merchantId,
      [{ productId: coffeeBeans.id, product: coffeeBeans }],
      new Set<string>()
    )

    expect(candidate).not.toBeNull()
    expect(candidate?.product.id).toBe('prod-filters-1')
    expect(candidate?.reasoning.marginHealth).toContain('71% gross margin preserved')
    expect(candidate?.reasoning.inventoryDepth).toContain('50 units available')
    expect(mocks.productFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          merchantId,
          inventory: { gt: 0 },
          OR: expect.arrayContaining([
            expect.objectContaining({
              price: expect.objectContaining({
                gte: expect.any(Number),
                lte: expect.any(Number),
              }),
            }),
          ]),
        }),
      })
    )
  })

  it('discovers upsell candidate by matching category and higher price tier', async () => {
    mocks.productFindMany.mockResolvedValue([premiumCoffee])

    const candidate = await findIntelligentUpsellCandidate(
      merchantId,
      [{ productId: coffeeBeans.id, product: coffeeBeans }],
      new Set<string>()
    )

    expect(candidate).not.toBeNull()
    expect(candidate?.product.id).toBe('prod-coffee-reserve')
    expect(candidate?.reasoning.compatibilityReason).toContain('Upgraded')
    expect(candidate?.reasoning.marginHealth).toContain('gross margin preserved')
  })

  it('returns null when no eligible in-stock candidates exist', async () => {
    mocks.productFindMany.mockResolvedValue([])

    const candidate = await findIntelligentCrossSellCandidate(
      merchantId,
      [{ productId: coffeeBeans.id, product: coffeeBeans }],
      new Set<string>()
    )

    expect(candidate).toBeNull()
  })
})
