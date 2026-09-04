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

import { findIntelligentCrossSellCandidate } from '@/backend/ai/recommendationIntelligence'
import { Product } from '@prisma/client'

describe('Empirical Co-Purchase Mining & Cross-Sell Recommendation', () => {
  const merchantId = 'merchant-test-copurchase'

  const keyboardProduct: Product = {
    id: 'prod-k1',
    merchantId,
    name: 'Tactile Keyboard',
    description: 'High performance keyboard',
    price: 500000,
    cost: 250000,
    inventory: 15,
    category: 'keyboards',
    tags: ['keyboard', 'peripheral'],
    complementaryProducts: [],
    upgradeProducts: [],
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  }

  const wristRestProduct: Product = {
    id: 'prod-w1',
    merchantId,
    name: 'Ergonomic Wrist Rest',
    description: 'Plush foam wrist rest',
    price: 120000,
    cost: 40000,
    inventory: 30,
    category: 'wrist rests',
    tags: ['accessory', 'ergonomic'],
    complementaryProducts: [],
    upgradeProducts: [],
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  }

  beforeEach(() => {
    vi.resetAllMocks()
    mocks.productFindUnique.mockResolvedValue(null)
    mocks.productFindMany.mockResolvedValue([])
  })

  it('identifies top co-purchased products from historical paid orders and incorporates them into candidates', async () => {
    // Mock historical paid orders where keyboard was purchased alongside wrist rest
    mocks.orderFindMany.mockResolvedValue([
      {
        items: [{ productId: 'prod-k1' }, { productId: 'prod-w1' }],
      },
      {
        items: [{ productId: 'prod-k1' }, { productId: 'prod-w1' }],
      },
    ])

    // Mock coPurchaseProducts query
    mocks.productFindMany.mockImplementation(async (args: { where?: { id?: { in?: string[] } } }) => {
      if (args?.where?.id?.in?.includes('prod-w1')) {
        return [wristRestProduct]
      }
      return []
    })

    const candidate = await findIntelligentCrossSellCandidate(
      merchantId,
      [{ productId: keyboardProduct.id, product: keyboardProduct }],
      new Set<string>()
    )

    expect(candidate).not.toBeNull()
    expect(candidate?.product.id).toBe('prod-w1')
    expect(candidate?.product.name).toBe('Ergonomic Wrist Rest')
    expect(candidate?.reasoning.categoryMatch).toContain('keyboards & wrist rests synergy')
    expect(mocks.orderFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          merchantId,
          status: 'PAID',
          items: { some: { productId: { in: ['prod-k1'] } } },
        }),
      })
    )
  })

  it('gracefully degrades to dynamic category affinity when historical co-purchase query fails', async () => {
    // Simulate database failure during order mining
    mocks.orderFindMany.mockRejectedValue(new Error('Connection pool exhausted'))

    // Category affinity fallback candidate
    mocks.productFindMany.mockResolvedValue([wristRestProduct])

    const candidate = await findIntelligentCrossSellCandidate(
      merchantId,
      [{ productId: keyboardProduct.id, product: keyboardProduct }],
      new Set<string>()
    )

    expect(candidate).not.toBeNull()
    expect(candidate?.product.id).toBe('prod-w1')
  })
})
