import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireCustomer: vi.fn(),
  cartFindFirst: vi.fn(),
  cartFindMany: vi.fn(),
  campaignFindFirst: vi.fn(),
  policyFindMany: vi.fn(),
  intentFindFirst: vi.fn(),
  orderFindMany: vi.fn(),
  orderAggregate: vi.fn(),
  customerFindUnique: vi.fn(),
  executeRaw: vi.fn(),
  offerCreate: vi.fn(),
  auditCreate: vi.fn(),
}))

vi.mock('@/backend/auth/session', () => ({ requireCustomer: mocks.requireCustomer }))
vi.mock('@/backend/db/prisma', () => ({
  prisma: {
    cart: { findFirst: mocks.cartFindFirst, findMany: mocks.cartFindMany },
    campaign: { findFirst: mocks.campaignFindFirst },
    merchantPolicy: { findMany: mocks.policyFindMany },
    buyerIntent: { findFirst: mocks.intentFindFirst },
    order: { findMany: mocks.orderFindMany, aggregate: mocks.orderAggregate, count: vi.fn().mockResolvedValue(0) },
    customer: { findUnique: mocks.customerFindUnique },
    $executeRaw: mocks.executeRaw,
    offer: { create: mocks.offerCreate },
    auditLog: { create: mocks.auditCreate },
  },
}))

import { createOfferFromActiveCart } from '@/backend/actions/commerce'
import { bindingsMatch, cartSelectionBinding } from '@/backend/utils/cartSelectionBinding'

const MERCHANT_A = '11111111-1111-4111-8111-111111111111'
// const MERCHANT_B 
const CAMPAIGN = '33333333-3333-4333-8333-333333333333'
const PRODUCT = 'd560ebdc-263c-4edb-82f7-f46b12ba5b65'

function cartFixture(id: string, merchantId: string) {
  return {
    id,
    merchantId,
    items: [
      {
        productId: PRODUCT,
        quantity: 2,
        product: { id: PRODUCT, merchantId, price: 1000, cost: 400, inventory: 3 },
      },
    ],
  }
}

describe('customer cart offer binding', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    process.env.OFFER_BINDING_SECRET = 'unit-test-binding-secret'
    mocks.requireCustomer.mockResolvedValue({ user: { id: 'user-1' }, customer: { id: 'customer-1' } })
    mocks.cartFindFirst.mockResolvedValue(cartFixture('cart-1', MERCHANT_A))
    mocks.cartFindMany.mockResolvedValue([cartFixture('cart-1', MERCHANT_A)])
    mocks.policyFindMany.mockResolvedValue([
      { key: 'MAX_DISCOUNT_PERCENTAGE', value: 15 },
      { key: 'MIN_MARGIN_PERCENTAGE', value: 8 },
      { key: 'MAX_AUTONOMOUS_SPEND', value: 100000 },
    ])
    mocks.intentFindFirst.mockResolvedValue(null)
    mocks.customerFindUnique.mockResolvedValue({ dailySpendLimit: 1_000_000, monthlySpendLimit: 10_000_000 })
    mocks.orderAggregate.mockResolvedValue({ _sum: { totalAmount: 0 } })
    mocks.offerCreate.mockImplementation(async ({ data }) => ({ id: 'offer-1', ...data, items: [] }))
  })

  test('derives offer lines only from the persisted active cart and signs them', async () => {
    mocks.campaignFindFirst.mockResolvedValue({
      id: CAMPAIGN,
      discountPercent: 10,
      status: 'APPROVED',
      type: 'RECOVERY',
      configuration: { cartIds: ['cart-1'], discountPercent: 10 },
    })
    await createOfferFromActiveCart({ discountPercentage: 10, campaignId: CAMPAIGN, merchantId: MERCHANT_A })

    expect(mocks.offerCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        cartId: 'cart-1',
        merchantId: MERCHANT_A,
        cartSnapshotHash: expect.any(String),
        items: { create: [{ productId: PRODUCT, quantity: 2, unitPrice: 900 }] },
      }),
    }))
  })

  test('scopes the basket query to the merchant when one is supplied', async () => {
    await createOfferFromActiveCart({ discountPercentage: 0, merchantId: MERCHANT_A })

    expect(mocks.cartFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { customerId: 'customer-1', merchantId: MERCHANT_A, status: 'ACTIVE' },
    }))
    // The ambiguity-tolerant fallback must not run once the caller has been
    // explicit about which storefront the basket belongs to.
    expect(mocks.cartFindMany).not.toHaveBeenCalled()
  })

  


  test('rejects a campaignId that is not an approved campaign for the basket merchant', async () => {
    mocks.campaignFindFirst.mockResolvedValue(null)

    await expect(createOfferFromActiveCart({ discountPercentage: 10, campaignId: CAMPAIGN, merchantId: MERCHANT_A }))
      .rejects.toThrow('not an approved campaign')
    expect(mocks.offerCreate).not.toHaveBeenCalled()
  })

  test('checks campaign ownership against the basket merchant, not the caller', async () => {
    mocks.campaignFindFirst.mockResolvedValue({
      id: CAMPAIGN,
      discountPercent: 10,
      status: 'APPROVED',
      type: 'RECOVERY',
      configuration: { cartIds: ['cart-1'], discountPercent: 10 },
    })

    await createOfferFromActiveCart({ discountPercentage: 10, campaignId: CAMPAIGN, merchantId: MERCHANT_A })

    expect(mocks.campaignFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: CAMPAIGN, merchantId: MERCHANT_A, status: 'APPROVED' },
    }))
    // A campaign never suppresses the binding any more -- it is persisted
    // alongside a hash, not instead of one.
    expect(mocks.offerCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ campaignId: CAMPAIGN, cartSnapshotHash: expect.any(String) }),
    }))
  })

  test('changes the HMAC whenever a product line is altered', () => {
    const base = { customerId: 'customer-1', merchantId: MERCHANT_A, cartId: 'cart-1' }
    const original = cartSelectionBinding({ ...base, items: [{ productId: 'one', quantity: 1, unitPrice: 100 }] })
    const changed = cartSelectionBinding({ ...base, items: [{ productId: 'two', quantity: 1, unitPrice: 100 }] })
    expect(changed).not.toBe(original)
  })

  test('canonicalises repeated product lines to a total order', () => {
    const base = { customerId: 'customer-1', merchantId: MERCHANT_A, cartId: 'cart-1' }
    // Same lines, different input order. Sorting on productId alone left these
    // tied, so the digest depended on array order and a legitimate offer could
    // fail to reproduce its own binding at checkout.
    const forward = cartSelectionBinding({
      ...base,
      items: [{ productId: PRODUCT, quantity: 1, unitPrice: 100 }, { productId: PRODUCT, quantity: 2, unitPrice: 100 }],
    })
    const reversed = cartSelectionBinding({
      ...base,
      items: [{ productId: PRODUCT, quantity: 2, unitPrice: 100 }, { productId: PRODUCT, quantity: 1, unitPrice: 100 }],
    })
    expect(reversed).toBe(forward)

    // Still sensitive to the values themselves, not just their multiset order.
    const repriced = cartSelectionBinding({
      ...base,
      items: [{ productId: PRODUCT, quantity: 1, unitPrice: 100 }, { productId: PRODUCT, quantity: 2, unitPrice: 101 }],
    })
    expect(repriced).not.toBe(forward)
  })
})

describe('bindingsMatch', () => {
  test('accepts an identical digest and rejects any other', () => {
    const digest = 'a'.repeat(64)
    expect(bindingsMatch(digest, digest)).toBe(true)
    // Same length, differs in the last byte -- the case a non-constant-time
    // compare would leak the most information about.
    expect(bindingsMatch(digest, `${'a'.repeat(63)}b`)).toBe(false)
  })

  test('returns false instead of throwing on a length mismatch', () => {
    expect(bindingsMatch('a'.repeat(64), 'a'.repeat(63))).toBe(false)
    expect(bindingsMatch('a'.repeat(64), '')).toBe(false)
  })
})
