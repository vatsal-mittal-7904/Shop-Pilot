import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  cartFindMany: vi.fn(),
  policyFindMany: vi.fn(),
  productFindMany: vi.fn(),
  orderFindMany: vi.fn(),
  customerFindMany: vi.fn(),
}))

vi.mock('@/backend/db/prisma', () => ({
  prisma: {
    cart: { findMany: mocks.cartFindMany },
    merchantPolicy: { findMany: mocks.policyFindMany },
    product: { findMany: mocks.productFindMany },
    order: { findMany: mocks.orderFindMany },
    customer: { findMany: mocks.customerFindMany },
  },
}))

import {
  gatherMerchantTelemetry,
  generateAnalyticalCampaignProposals,
} from '@/backend/actions/campaignProposalEngine'

describe('Autonomous Campaign Proposal Engine', () => {
  const MERCHANT_ID = '11111111-1111-4111-8111-111111111111'
  const PROD_1 = '22222222-2222-4222-8222-222222222222'
  const PROD_2 = '33333333-3333-4333-8333-333333333333'
  const CUST_1 = '44444444-4444-4444-8444-444444444444'

  beforeEach(() => {
    vi.resetAllMocks()

    mocks.policyFindMany.mockResolvedValue([
      { key: 'MAX_DISCOUNT_PERCENTAGE', value: 15 },
      { key: 'MIN_MARGIN_PERCENTAGE', value: 10 },
      { key: 'MAX_CART_RECOVERY_DISCOUNT', value: 20 },
      { key: 'CLEARANCE_INVENTORY_THRESHOLD', value: 20 },
      { key: 'CLEARANCE_DISCOUNT_PERCENTAGE', value: 25 },
      { key: 'CAMPAIGN_BUDGET_LIMIT', value: 10000000 },
    ])

    mocks.cartFindMany.mockResolvedValue([
      {
        id: 'cart-1',
        merchantId: MERCHANT_ID,
        status: 'ABANDONED',
        updatedAt: new Date(Date.now() - 40 * 60 * 1000), // 40m ago
        items: [
          {
            quantity: 1,
            product: { id: PROD_1, name: 'Mechanical Keyboard', price: 700000, cost: 400000, category: 'Peripherals' },
          },
        ],
      },
    ])

    mocks.productFindMany.mockResolvedValue([
      {
        id: PROD_2,
        name: 'Desk Mat XL',
        category: 'Accessories',
        price: 150000,
        cost: 60000,
        inventory: 45, // Exceeds threshold of 20
      },
    ])

    mocks.orderFindMany.mockResolvedValue([
      { customerId: CUST_1, status: 'PAID', items: [{ productId: PROD_1 }] },
    ])

    mocks.customerFindMany.mockResolvedValue([{ id: CUST_1 }])
  })

  it('gathers multi-dimensional telemetry across carts, stock, cohorts, and policies', async () => {
    const telemetry = await gatherMerchantTelemetry(MERCHANT_ID)

    expect(telemetry.abandonedCarts.count).toBe(1)
    expect(telemetry.abandonedCarts.totalValue).toBe(700000)
    expect(telemetry.abandonedCarts.categories).toContain('Peripherals')
    expect(telemetry.slowMovingInventory).toHaveLength(1)
    expect(telemetry.slowMovingInventory[0].inventory).toBe(45)
    expect(telemetry.slowMovingInventory[0].grossMarginPercent).toBe(60)
  })

  it('generates high-ROI recovery proposal with data-grounded rationale and policy-capped discount', async () => {
    const proposals = await generateAnalyticalCampaignProposals(MERCHANT_ID)

    const recovery = proposals.find((p) => p.type === 'RECOVERY')
    expect(recovery).toBeDefined()
    expect(recovery?.title).toContain('Cart Recovery')
    expect(recovery?.reason).toContain('1 abandoned cart')
    expect(recovery?.reason).toContain('Peripherals')
    expect(recovery?.configuration.discountPercent).toBeLessThanOrEqual(15) // Clamped to MAX_DISCOUNT_PERCENTAGE
    expect(recovery?.policy.allowed).toBe(true)
  })

  it('generates inventory clearance proposal targeting eligible prior buyers', async () => {
    const proposals = await generateAnalyticalCampaignProposals(MERCHANT_ID)

    const clearance = proposals.find((p) => p.type === 'CLEARANCE')
    expect(clearance).toBeDefined()
    expect(clearance?.title).toContain('Inventory Clearance')
    expect(clearance?.reason).toContain('Desk Mat XL')
    expect(clearance?.reason).toContain('45 units')
    expect(clearance?.configuration.productId).toBe(PROD_2)
    expect(clearance?.configuration.customerIds).toEqual([CUST_1])
    expect(clearance?.configuration.discountPercent).toBeLessThanOrEqual(15)
  })

  it('flags policy violation when campaign budget exceeds CAMPAIGN_BUDGET_LIMIT', async () => {
    mocks.policyFindMany.mockResolvedValue([
      { key: 'MAX_DISCOUNT_PERCENTAGE', value: 15 },
      { key: 'CAMPAIGN_BUDGET_LIMIT', value: 100 }, // Extremely low budget of ₹1
    ])

    const proposals = await generateAnalyticalCampaignProposals(MERCHANT_ID)
    const recovery = proposals.find((p) => p.type === 'RECOVERY')
    expect(recovery?.policy.allowed).toBe(false)
    expect(recovery?.policy.reason).toContain('exceeds')
  })
})
