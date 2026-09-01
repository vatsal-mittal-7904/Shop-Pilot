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
    order: { findMany: mocks.orderFindMany, aggregate: mocks.orderAggregate },
    customer: { findUnique: mocks.customerFindUnique },
    $executeRaw: mocks.executeRaw,
    offer: { create: mocks.offerCreate },
    auditLog: { create: mocks.auditCreate },
  },
}))

import { createOfferFromActiveCart } from '@/backend/actions/commerce'

const MERCHANT_ID = '11111111-1111-4111-8111-111111111111'
const CAMPAIGN_ID = '33333333-3333-4333-8333-333333333333'
const PRODUCT_ID = 'd560ebdc-263c-4edb-82f7-f46b12ba5b65'

function cartFixture() {
  return {
    id: 'cart-1',
    merchantId: MERCHANT_ID,
    items: [
      {
        productId: PRODUCT_ID,
        quantity: 1,
        product: { id: PRODUCT_ID, merchantId: MERCHANT_ID, price: 10000, cost: 5000, inventory: 10 },
      },
    ],
  }
}

describe('discount authorization vs discount ceiling separation', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    process.env.OFFER_BINDING_SECRET = 'unit-test-binding-secret'
    mocks.requireCustomer.mockResolvedValue({ user: { id: 'user-1' }, customer: { id: 'customer-1' } })
    mocks.cartFindFirst.mockResolvedValue(cartFixture())
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

  test('rejects a non-zero discount when no campaign is provided, even if within ceiling', async () => {
    // Policy ceiling allows up to 15%, but model/caller asks for 15% without campaign authorization
    await expect(createOfferFromActiveCart({ discountPercentage: 15, merchantId: MERCHANT_ID }))
      .rejects.toThrow('Discounts are not authorized without an approved campaign.')
    expect(mocks.offerCreate).not.toHaveBeenCalled()
  })

  test('rejects unapproved campaign ID', async () => {
    mocks.campaignFindFirst.mockResolvedValue(null)

    await expect(createOfferFromActiveCart({ discountPercentage: 10, campaignId: CAMPAIGN_ID, merchantId: MERCHANT_ID }))
      .rejects.toThrow('That campaign is not an approved campaign for this merchant.')
    expect(mocks.offerCreate).not.toHaveBeenCalled()
  })

  test('rejects when requested discount exceeds authorized campaign discount', async () => {
    // Campaign only authorizes 10%, but caller requested 15%
    mocks.campaignFindFirst.mockResolvedValue({
      id: CAMPAIGN_ID,
      merchantId: MERCHANT_ID,
      status: 'APPROVED',
      discountPercent: 10,
    })

    await expect(createOfferFromActiveCart({ discountPercentage: 15, campaignId: CAMPAIGN_ID, merchantId: MERCHANT_ID }))
      .rejects.toThrow('exceeds the authorized campaign discount')
    expect(mocks.offerCreate).not.toHaveBeenCalled()
  })

  test('rejects when authorized campaign discount exceeds merchant policy ceiling', async () => {
    // Campaign authorizes 20%, but merchant policy ceiling is 15%
    mocks.campaignFindFirst.mockResolvedValue({
      id: CAMPAIGN_ID,
      merchantId: MERCHANT_ID,
      status: 'APPROVED',
      discountPercent: 20,
    })

    await expect(createOfferFromActiveCart({ discountPercentage: 20, campaignId: CAMPAIGN_ID, merchantId: MERCHANT_ID }))
      .rejects.toThrow('Discount exceeds the 15% merchant limit')
    expect(mocks.offerCreate).not.toHaveBeenCalled()
  })

  test('successfully creates offer when discount is authorized by an approved campaign within ceiling', async () => {
    mocks.campaignFindFirst.mockResolvedValue({
      id: CAMPAIGN_ID,
      merchantId: MERCHANT_ID,
      status: 'APPROVED',
      discountPercent: 10,
    })

    const offer = await createOfferFromActiveCart({
      discountPercentage: 10,
      campaignId: CAMPAIGN_ID,
      merchantId: MERCHANT_ID,
    })

    expect(offer.id).toBe('offer-1')
    expect(mocks.offerCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        campaignId: CAMPAIGN_ID,
        discountPercent: 10,
        subtotal: 10000,
        discount: 1000,
        total: 9000,
      }),
    }))
  })

  test('successfully creates offer when discount is in campaign configuration', async () => {
    mocks.campaignFindFirst.mockResolvedValue({
      id: CAMPAIGN_ID,
      merchantId: MERCHANT_ID,
      status: 'APPROVED',
      discountPercent: null,
      configuration: { discountPercent: 12 },
    })

    const offer = await createOfferFromActiveCart({
      discountPercentage: 12,
      campaignId: CAMPAIGN_ID,
      merchantId: MERCHANT_ID,
    })

    expect(offer.id).toBe('offer-1')
    expect(mocks.offerCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        campaignId: CAMPAIGN_ID,
        discountPercent: 12,
        subtotal: 10000,
        discount: 1200,
        total: 8800,
      }),
    }))
  })

  test('rejects offer when authorized discount violates minimum merchant margin', async () => {
    // High cost product where 10% discount leaves margin < 8%
    mocks.cartFindFirst.mockResolvedValue({
      id: 'cart-1',
      merchantId: MERCHANT_ID,
      items: [
        {
          productId: PRODUCT_ID,
          quantity: 1,
          product: { id: PRODUCT_ID, merchantId: MERCHANT_ID, price: 10000, cost: 9500, inventory: 10 },
        },
      ],
    })
    mocks.campaignFindFirst.mockResolvedValue({
      id: CAMPAIGN_ID,
      merchantId: MERCHANT_ID,
      status: 'APPROVED',
      discountPercent: 10,
    })

    await expect(createOfferFromActiveCart({
      discountPercentage: 10,
      campaignId: CAMPAIGN_ID,
      merchantId: MERCHANT_ID,
    })).rejects.toThrow('Offer would violate the minimum merchant margin')
    expect(mocks.offerCreate).not.toHaveBeenCalled()
  })

  test('allows standard offer creation with 0% discount without campaign', async () => {
    const offer = await createOfferFromActiveCart({
      discountPercentage: 0,
      merchantId: MERCHANT_ID,
    })

    expect(offer.id).toBe('offer-1')
    expect(mocks.offerCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        discountPercent: 0,
        subtotal: 10000,
        discount: 0,
        total: 10000,
      }),
    }))
  })
})
