import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  cartFindMany: vi.fn(),
  merchantPolicyFindMany: vi.fn(),
  productFindMany: vi.fn(),
  orderFindMany: vi.fn(),
  customerFindMany: vi.fn(),
  generateObject: vi.fn(),
}))

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>()
  return {
    ...actual,
    generateObject: mocks.generateObject,
  }
})

vi.mock('@/backend/db/prisma', () => ({
  prisma: {
    cart: { findMany: mocks.cartFindMany },
    merchantPolicy: { findMany: mocks.merchantPolicyFindMany },
    product: { findMany: mocks.productFindMany },
    order: { findMany: mocks.orderFindMany },
    customer: { findMany: mocks.customerFindMany },
  },
}))

import { generateModelDerivedCampaignProposals } from '@/backend/ai/campaignStrategyAgent'

describe('Model-Derived AI Growth Strategy Engine', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('formulates data-grounded growth campaign proposals from live merchant telemetry', async () => {
    const merchantId = 'merchant-test-1'

    // Mock abandoned cart telemetry
    mocks.cartFindMany.mockResolvedValue([
      {
        id: 'cart-1',
        merchantId,
        status: 'ABANDONED',
        updatedAt: new Date(Date.now() - 30 * 60000), // 30 mins ago
        items: [
          {
            product: {
              name: 'Mechanical Keyboard',
              category: 'Keyboards',
              price: 800000,
            },
            quantity: 1,
          },
        ],
      },
    ])

    // Mock merchant policies
    mocks.merchantPolicyFindMany.mockResolvedValue([
      { key: 'CAMPAIGN_BUDGET_LIMIT', value: 5000000 },
      { key: 'MAX_DISCOUNT_PERCENTAGE', value: 15 },
      { key: 'MIN_MARGIN_PERCENTAGE', value: 10 },
      { key: 'CLEARANCE_INVENTORY_THRESHOLD', value: 15 },
    ])

    // Mock products with slow-moving inventory
    mocks.productFindMany.mockResolvedValue([
      {
        id: 'prod-dead-1',
        merchantId,
        name: 'Braided Audio Cable',
        category: 'Audio',
        price: 100000,
        cost: 30000,
        inventory: 40, // High inventory
      },
    ])

    // Mock paid orders
    mocks.orderFindMany.mockResolvedValue([
      { customerId: 'cust-1', merchantId, status: 'PAID', items: [] },
      { customerId: 'cust-1', merchantId, status: 'PAID', items: [] },
    ])

    // Mock customer recipients
    mocks.customerFindMany.mockResolvedValue([{ id: 'cust-1' }, { id: 'cust-2' }])

    // Mock AI SDK structured response
    mocks.generateObject.mockResolvedValue({
      object: {
        strategicDiagnosis: 'Healthy basket sizes but high dropoff on premium mechanical keyboards.',
        recoveryProposal: {
          title: 'AI Growth Sprint: 10% Dynamic Abandoned Cart Recovery',
          recommendedDiscountPercent: 10,
          rationale: 'AI Growth Strategy formulated a dynamic 10% incentive targeting abandoned baskets.',
          projectedRecoveryRate: '28-35%',
        },
        clearanceProposal: {
          title: 'Capital Velocity Clearance: Braided Audio Cable (15% Off)',
          recommendedDiscountPercent: 15,
          rationale: 'AI Stock Velocity Analysis detected holding exposure on Braided Audio Cable.',
        },
      },
    })

    const proposals = await generateModelDerivedCampaignProposals(merchantId)

    expect(proposals.length).toBeGreaterThanOrEqual(2)

    // Verify Abandoned Cart Proposal
    const cartProposal = proposals.find((p) => p.id === 'abandoned-cart')
    expect(cartProposal).toBeDefined()
    expect(cartProposal!.type).toBe('RECOVERY')
    expect(cartProposal!.estimatedImpact).toBe(800000)
    expect(cartProposal!.budget).toBeLessThanOrEqual(5000000)
    expect(cartProposal!.policy.allowed).toBe(true)
    expect(cartProposal!.reason).toContain('AI Growth Strategy formulated a dynamic')

    // Verify Clearance Proposal
    const clearanceProposal = proposals.find((p) => p.id === 'clearance')
    expect(clearanceProposal).toBeDefined()
    expect(clearanceProposal!.type).toBe('CLEARANCE')
    expect(clearanceProposal!.policy.allowed).toBe(true)
    expect(clearanceProposal!.reason).toContain('AI Stock Velocity Analysis detected')
  })

  it('gracefully falls back to analytical baseline when LLM call throws an error', async () => {
    const merchantId = 'merchant-test-2'

    mocks.cartFindMany.mockResolvedValue([
      {
        id: 'cart-2',
        merchantId,
        status: 'ABANDONED',
        updatedAt: new Date(Date.now() - 45 * 60000),
        items: [{ product: { name: 'Mouse', category: 'Mice', price: 400000 }, quantity: 1 }],
      },
    ])

    mocks.merchantPolicyFindMany.mockResolvedValue([
      { key: 'CAMPAIGN_BUDGET_LIMIT', value: 5000000 },
      { key: 'MAX_DISCOUNT_PERCENTAGE', value: 15 },
      { key: 'MIN_MARGIN_PERCENTAGE', value: 10 },
    ])

    mocks.productFindMany.mockResolvedValue([])
    mocks.orderFindMany.mockResolvedValue([])
    mocks.customerFindMany.mockResolvedValue([])

    // Simulate LLM error (e.g. rate limit, offline API)
    mocks.generateObject.mockRejectedValue(new Error('LLM Provider timeout'))

    const proposals = await generateModelDerivedCampaignProposals(merchantId)

    expect(proposals.length).toBeGreaterThanOrEqual(1)
    const cartProposal = proposals.find((p) => p.id === 'abandoned-cart')
    expect(cartProposal).toBeDefined()
    expect(cartProposal!.type).toBe('RECOVERY')
    expect(cartProposal!.policy.allowed).toBe(true)
  })
})
