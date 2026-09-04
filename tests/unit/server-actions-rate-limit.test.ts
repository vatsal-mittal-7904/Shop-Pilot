import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireCustomer: vi.fn(),
  checkDistributedRateLimit: vi.fn(),
  prismaTransaction: vi.fn(),
  prismaCartFindFirst: vi.fn(),
  prismaOfferFindFirst: vi.fn(),
}))

vi.mock('@/backend/auth/session', () => ({
  requireCustomer: mocks.requireCustomer,
}))

vi.mock('@/backend/actions/payment', () => ({
  createRazorpayOrder: vi.fn(),
}))

vi.mock('@/backend/utils/rateLimit', () => ({
  checkDistributedRateLimit: mocks.checkDistributedRateLimit,
}))

vi.mock('@/backend/db/prisma', () => ({
  prisma: {
    $transaction: mocks.prismaTransaction,
    cart: { findFirst: mocks.prismaCartFindFirst },
    offer: { findFirst: mocks.prismaOfferFindFirst },
  },
}))

import { addProductToCart } from '@/backend/actions/cart'
import { acceptOfferForCheckout, createOrReuseCheckoutOrder } from '@/backend/actions/order'
import { acceptRecommendation, declineRecommendation } from '@/backend/actions/offer'

describe('Server Actions Distributed Rate Limiting Protection', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.requireCustomer.mockResolvedValue({
      user: { id: 'user-rt-1' },
      customer: { id: 'cust-rt-1' },
    })
  })

  it('rejects addProductToCart when customer exceeds burst rate limit', async () => {
    mocks.checkDistributedRateLimit.mockReturnValue({
      allowed: false,
      remaining: 0,
      limit: 20,
      retryAfterMs: 1500,
    })

    await expect(addProductToCart('prod-1')).rejects.toThrow(
      'Rate limit exceeded for basket updates. Please wait a moment.'
    )
    expect(mocks.checkDistributedRateLimit).toHaveBeenCalledWith(
      'customer:cart:cust-rt-1',
      expect.objectContaining({ maxRequests: 30, windowMs: 60_000 })
    )
    expect(mocks.prismaTransaction).not.toHaveBeenCalled()
  })

  it('rejects acceptOfferForCheckout when rate limited', async () => {
    mocks.checkDistributedRateLimit.mockReturnValue({
      allowed: false,
      remaining: 0,
      limit: 20,
      retryAfterMs: 2000,
    })

    await expect(acceptOfferForCheckout('offer-1')).rejects.toThrow(
      'Rate limit exceeded for offer acceptance. Please wait a moment.'
    )
    expect(mocks.checkDistributedRateLimit).toHaveBeenCalledWith(
      'customer:offer-accept:cust-rt-1',
      expect.objectContaining({ maxRequests: 20, windowMs: 60_000 })
    )
    expect(mocks.prismaTransaction).not.toHaveBeenCalled()
  })

  it('rejects createOrReuseCheckoutOrder when rate limited', async () => {
    mocks.checkDistributedRateLimit.mockReturnValue({
      allowed: false,
      remaining: 0,
      limit: 20,
      retryAfterMs: 2000,
    })

    await expect(createOrReuseCheckoutOrder('offer-1')).rejects.toThrow(
      'Rate limit exceeded for starting checkout. Please wait a moment.'
    )
    expect(mocks.checkDistributedRateLimit).toHaveBeenCalledWith(
      'customer:checkout-start:cust-rt-1',
      expect.objectContaining({ maxRequests: 20, windowMs: 60_000 })
    )
    expect(mocks.prismaTransaction).not.toHaveBeenCalled()
  })

  it('rejects acceptRecommendation when rate limited', async () => {
    mocks.checkDistributedRateLimit.mockReturnValue({
      allowed: false,
      remaining: 0,
      limit: 20,
      retryAfterMs: 2000,
    })

    await expect(
      acceptRecommendation({
        cartId: 'cart-1',
        offerId: 'offer-1',
        candidateProductId: 'prod-addon-1',
        actionType: 'cross-sell',
      })
    ).rejects.toThrow('Rate limit exceeded for recommendation acceptance. Please wait a moment.')

    expect(mocks.checkDistributedRateLimit).toHaveBeenCalledWith(
      'customer:recommendation-accept:cust-rt-1',
      expect.objectContaining({ maxRequests: 20, windowMs: 60_000 })
    )
    expect(mocks.prismaTransaction).not.toHaveBeenCalled()
  })

  it('rejects declineRecommendation when rate limited', async () => {
    mocks.checkDistributedRateLimit.mockReturnValue({
      allowed: false,
      remaining: 0,
      limit: 20,
      retryAfterMs: 2000,
    })

    await expect(
      declineRecommendation({
        cartId: 'cart-1',
        offerId: 'offer-1',
        candidateProductId: 'prod-addon-1',
      })
    ).rejects.toThrow('Rate limit exceeded. Please wait a moment.')

    expect(mocks.checkDistributedRateLimit).toHaveBeenCalledWith(
      'customer:recommendation-decline:cust-rt-1',
      expect.objectContaining({ maxRequests: 20, windowMs: 60_000 })
    )
    expect(mocks.prismaTransaction).not.toHaveBeenCalled()
  })
})
