import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  productFindMany: vi.fn(),
}))

vi.mock('@/backend/db/prisma', () => ({
  prisma: {
    product: {
      findMany: mocks.productFindMany,
    },
  },
}))

import { shouldTriggerCatalogSearch } from '@/backend/utils/dynamicTaxonomy'

describe('Dynamic Catalog Taxonomy & Commerce Intent Routing', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.productFindMany.mockResolvedValue([
      { category: 'Footwear', tags: ['running', 'marathon'], name: 'AeroGlide Running Shoes' },
      { category: 'Coffee Equipment', tags: ['espresso', 'brewing'], name: 'Artisan Espresso Machine' },
      { category: 'Office Furniture', tags: ['ergonomic', 'lumbar'], name: 'ErgoComfort Executive Chair' },
    ])
  })

  test('triggers catalog search for generic shopping verbs and price queries', async () => {
    const result1 = await shouldTriggerCatalogSearch('merchant-1', 'Looking for something under 5000 rupees')
    expect(result1).toBe(true)

    const result2 = await shouldTriggerCatalogSearch('merchant-1', 'Show me your best options')
    expect(result2).toBe(true)

    const result3 = await shouldTriggerCatalogSearch('merchant-1', 'What is the price of that?')
    expect(result3).toBe(true)
  })

  test('triggers catalog search when structured buyer intent has extracted category or budget', async () => {
    const intentWithCategory = { category: ['Apparel'], maximumAmount: null }
    const result = await shouldTriggerCatalogSearch('merchant-1', 'I need a jacket', intentWithCategory)
    expect(result).toBe(true)

    const intentWithBudget = { category: [], maximumAmount: 1000000 }
    const resultBudget = await shouldTriggerCatalogSearch('merchant-1', 'My limit is set', intentWithBudget)
    expect(resultBudget).toBe(true)
  })

  test('dynamically triggers catalog search for non-tech merchant categories present in database', async () => {
    // Non-tech queries that do not mention keyboard/mouse/headphones/etc.
    const footwearResult = await shouldTriggerCatalogSearch('merchant-1', 'Do you carry any running footwear?')
    expect(footwearResult).toBe(true)

    const coffeeResult = await shouldTriggerCatalogSearch('merchant-1', 'I need an espresso machine for home brewing')
    expect(coffeeResult).toBe(true)

    const chairResult = await shouldTriggerCatalogSearch('merchant-1', 'Tell me about the ErgoComfort Executive Chair')
    expect(chairResult).toBe(true)
  })

  test('does not trigger catalog search for non-shopping conversational chat', async () => {
    const casualResult = await shouldTriggerCatalogSearch('merchant-1', 'Hello, how is your day going?')
    expect(casualResult).toBe(false)

    const emptyResult = await shouldTriggerCatalogSearch('merchant-1', '')
    expect(emptyResult).toBe(false)
  })
})
