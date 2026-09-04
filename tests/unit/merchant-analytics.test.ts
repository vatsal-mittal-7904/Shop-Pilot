import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  orderFindMany: vi.fn(),
  recommendationCount: vi.fn(),
  recommendationFindMany: vi.fn(),
  productFindMany: vi.fn(),
  agentActionFindMany: vi.fn(),
  getRecoveryAttribution: vi.fn(),
}))

vi.mock('@/backend/db/prisma', () => ({
  prisma: {
    order: { findMany: mocks.orderFindMany },
    recommendation: {
      count: mocks.recommendationCount,
      findMany: mocks.recommendationFindMany,
    },
    product: { findMany: mocks.productFindMany },
    agentAction: { findMany: mocks.agentActionFindMany },
  },
}))

vi.mock('@/backend/actions/recoveryAttribution', () => ({
  getRecoveryAttribution: mocks.getRecoveryAttribution,
}))

import { getMerchantROI } from '@/backend/actions/analytics'

describe('getMerchantROI Descriptive Attribution', () => {
  const merchantId = 'a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d'

  beforeEach(() => {
    vi.resetAllMocks()
  })

  test('calculates honest direct attribution metrics and returns observational model metadata', async () => {
    // Paid orders total
    mocks.orderFindMany.mockResolvedValue([
      { totalAmount: 100000 },
      { totalAmount: 50000 },
    ])

    // recommendation counts: crossSellTotal, crossSellAccepted, upsellTotal, upsellAccepted
    mocks.recommendationCount
      .mockResolvedValueOnce(10) // crossSellTotal
      .mockResolvedValueOnce(6)  // crossSellAccepted
      .mockResolvedValueOnce(8)  // upsellTotal
      .mockResolvedValueOnce(4)  // upsellAccepted

    // Blocked actions
    mocks.agentActionFindMany.mockResolvedValue([
      { policyResult: { passed: false, checked: ['MAX_DISCOUNT_PERCENTAGE'] } },
      { policyResult: { passed: false, checked: ['MIN_MARGIN_PERCENTAGE'] } },
      { policyResult: null },
    ])

    // Recovery attribution
    mocks.getRecoveryAttribution.mockResolvedValue({
      revenue: 40000,
      recoveredOrders: 2,
    })

    // Paid cross-sells
    mocks.recommendationFindMany
      .mockResolvedValueOnce([
        {
          recommendedProductId: 'prod-mouse',
          offer: {
            items: [
              { productId: 'prod-kb', unitPrice: 3000, quantity: 1 },
              { productId: 'prod-mouse', unitPrice: 1500, quantity: 2 },
            ],
          },
        },
      ])
      // Paid upsells
      .mockResolvedValueOnce([
        {
          originalProductId: 'prod-standard',
          recommendedProductId: 'prod-pro',
          offer: {
            items: [
              { productId: 'prod-pro', unitPrice: 7000, quantity: 1 },
            ],
          },
        },
      ])

    // Original products for upsell comparison
    mocks.productFindMany.mockResolvedValue([
      { id: 'prod-standard', price: 5000 },
    ])

    const result = await getMerchantROI(merchantId)

    // Overall revenue: 100000 + 50000 = 150000
    expect(result.totalRevenueGenerated).toBe(150000)

    // Recovery
    expect(result.aiRecoveredRevenue).toBe(40000)
    expect(result.abandonedCartsRecovered).toBe(2)

    // Cross-sell: 1 paid recommendation (item unitPrice 1500 * 2 = 3000)
    expect(result.crossSellIncrementalRevenue).toBe(3000)
    expect(result.crossSellPaid).toBe(1)
    expect(result.crossSellTotal).toBe(10)
    expect(result.crossSellAccepted).toBe(6)
    expect(result.crossSellPaidRate).toBe(10) // (1 / 10) * 100

    // Upsell: 1 paid recommendation (pro 7000 - standard 5000 = 2000 * 1 = 2000)
    expect(result.upsellIncrementalRevenue).toBe(2000)
    expect(result.upsellPaid).toBe(1)
    expect(result.upsellTotal).toBe(8)
    expect(result.upsellAccepted).toBe(4)
    expect(result.upsellPaidRate).toBe(12.5) // (1 / 8) * 100

    // Total AI Attributed = 40000 (recovery) + 3000 (cross-sell) + 2000 (upsell) = 45000
    expect(result.totalAiAttributedRevenue).toBe(45000)

    // Only discount policy blocks matching MAX_DISCOUNT_PERCENTAGE
    expect(result.blockedDiscountPolicyRequests).toBe(1)

    // Observational attribution methodology
    expect(result.attributionMethodology.model).toBe('OBSERVATIONAL_DIRECT_ATTRIBUTION')
    expect(result.attributionMethodology.disclaimer).toContain('not a randomized controlled experiment')
  })

  test('safely handles zero denominators without NaN or Infinity', async () => {
    mocks.orderFindMany.mockResolvedValue([])
    mocks.recommendationCount
      .mockResolvedValueOnce(0) // crossSellTotal
      .mockResolvedValueOnce(0) // crossSellAccepted
      .mockResolvedValueOnce(0) // upsellTotal
      .mockResolvedValueOnce(0) // upsellAccepted
    mocks.agentActionFindMany.mockResolvedValue([])
    mocks.getRecoveryAttribution.mockResolvedValue({ revenue: 0, recoveredOrders: 0 })
    mocks.recommendationFindMany.mockResolvedValueOnce([]).mockResolvedValueOnce([])
    mocks.productFindMany.mockResolvedValue([])

    const result = await getMerchantROI(merchantId)

    expect(result.totalRevenueGenerated).toBe(0)
    expect(result.crossSellPaidRate).toBe(0)
    expect(result.upsellPaidRate).toBe(0)
    expect(result.crossSellIncrementalRevenue).toBe(0)
    expect(result.upsellIncrementalRevenue).toBe(0)
    expect(result.totalAiAttributedRevenue).toBe(0)
    expect(Number.isNaN(result.crossSellPaidRate)).toBe(false)
    expect(Number.isFinite(result.crossSellPaidRate)).toBe(true)
  })

  test('does not hide negative price differences with artificial Math.max clamps', async () => {
    mocks.orderFindMany.mockResolvedValue([])
    mocks.recommendationCount.mockResolvedValue(0)
    mocks.agentActionFindMany.mockResolvedValue([])
    mocks.getRecoveryAttribution.mockResolvedValue({ revenue: 0, recoveredOrders: 0 })

    mocks.recommendationFindMany
      .mockResolvedValueOnce([]) // cross-sell
      .mockResolvedValueOnce([
        {
          originalProductId: 'prod-expensive',
          recommendedProductId: 'prod-cheaper',
          offer: {
            items: [
              { productId: 'prod-cheaper', unitPrice: 3000, quantity: 1 },
            ],
          },
        },
      ])

    mocks.productFindMany.mockResolvedValue([
      { id: 'prod-expensive', price: 5000 },
    ])

    const result = await getMerchantROI(merchantId)

    // 3000 - 5000 = -2000. It must NOT be clamped to 0.
    expect(result.upsellIncrementalRevenue).toBe(-2000)
    expect(result.totalAiAttributedRevenue).toBe(-2000)
  })
})
