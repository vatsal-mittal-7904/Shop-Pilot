import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireCustomer: vi.fn(),
  transaction: vi.fn(),
  createRazorpayOrder: vi.fn(),
}))

vi.mock('@/backend/auth/session', () => ({ requireCustomer: mocks.requireCustomer }))
vi.mock('@/backend/db/prisma', () => ({ prisma: { $transaction: mocks.transaction } }))
vi.mock('@/backend/actions/payment', () => ({ createRazorpayOrder: mocks.createRazorpayOrder }))

import { acceptOfferForCheckout, createOrReuseCheckoutOrder } from '@/backend/actions/order'
import { cartSelectionBinding } from '@/backend/utils/cartSelectionBinding'

describe('checkout acceptance boundary', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.requireCustomer.mockResolvedValue({ user: { id: 'user-1' }, customer: { id: 'customer-1' } })
  })

  test('records a customer-owned acceptance before checkout', async () => {
    const tx = {
      offer: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'd560ebdc-263c-4edb-82f7-f46b12ba5b65',
          merchantId: 'merchant-1',
          total: 749900,
          status: 'ACTIVE',
          expiresAt: new Date(Date.now() + 60_000),
          acceptedAt: null,
          acceptedByUserId: null,
          campaignId: null,
          cartId: null,
          items: [{ quantity: 1, product: { inventory: 4 } }],
        }),
        update: vi.fn(),
      },
      cart: { updateMany: vi.fn() },
      auditLog: { create: vi.fn() },
    }
    mocks.transaction.mockImplementation(async (fn: (transaction: typeof tx) => Promise<unknown>) => fn(tx))

    const accepted = await acceptOfferForCheckout('d560ebdc-263c-4edb-82f7-f46b12ba5b65')

    expect(accepted.alreadyAccepted).toBe(false)
    expect(tx.offer.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'ACCEPTED', acceptedByUserId: 'user-1' }),
    }))
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'OFFER_ACCEPTED_BY_CUSTOMER', actorUserId: 'user-1' }),
    }))
  })

  test('refuses Razorpay checkout before an offer has a persisted acceptance', async () => {
    const tx = {
      offer: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'd560ebdc-263c-4edb-82f7-f46b12ba5b65',
          status: 'ACTIVE',
          expiresAt: new Date(Date.now() + 60_000),
          acceptedAt: null,
          acceptedByUserId: null,
          order: null,
        }),
        update: vi.fn(),
      },
    }
    mocks.transaction.mockImplementation(async (fn: (transaction: typeof tx) => Promise<unknown>) => fn(tx))

    await expect(createOrReuseCheckoutOrder('d560ebdc-263c-4edb-82f7-f46b12ba5b65'))
      .rejects.toThrow('Customer acceptance is required')
    expect(mocks.createRazorpayOrder).not.toHaveBeenCalled()
  })
})

const OFFER_ID = 'd560ebdc-263c-4edb-82f7-f46b12ba5b65'
const MERCHANT = '11111111-1111-4111-8111-111111111111'
const CAMPAIGN = '33333333-3333-4333-8333-333333333333'
const CART = '44444444-4444-4444-8444-444444444444'
const PRODUCT = '55555555-5555-4555-8555-555555555555'

describe('offer basket binding at acceptance', () => {
  const line = { productId: PRODUCT, quantity: 2, unitPrice: 900 }

  function buildTx(offerOverrides: Record<string, unknown>, campaign: unknown = null) {
    return {
      offer: {
        findFirst: vi.fn().mockResolvedValue({
          id: OFFER_ID,
          merchantId: MERCHANT,
          total: 1800,
          status: 'ACTIVE',
          expiresAt: new Date(Date.now() + 60_000),
          acceptedAt: null,
          acceptedByUserId: null,
          cartId: CART,
          campaignId: null,
          cartSnapshotHash: null,
          items: [{ ...line, product: { inventory: 4 } }],
          ...offerOverrides,
        }),
        update: vi.fn(),
      },
      campaign: { findFirst: vi.fn().mockResolvedValue(campaign) },
      cart: {
        findFirst: vi.fn().mockResolvedValue({ items: [{ productId: PRODUCT, quantity: 2 }] }),
        updateMany: vi.fn(),
      },
      $executeRaw: vi.fn(),
      auditLog: { create: vi.fn() },
    }
  }

  function useTx(tx: ReturnType<typeof buildTx>) {
    mocks.transaction.mockImplementation(async (fn: (transaction: typeof tx) => Promise<unknown>) => fn(tx))
    return tx
  }

  const validHash = () =>
    cartSelectionBinding({ customerId: 'customer-1', merchantId: MERCHANT, cartId: CART, items: [line] })

  beforeEach(() => {
    vi.resetAllMocks()
    process.env.OFFER_BINDING_SECRET = 'unit-test-binding-secret'
    mocks.requireCustomer.mockResolvedValue({ user: { id: 'user-1' }, customer: { id: 'customer-1' } })
  })

  test('accepts an offer whose binding reproduces from its own lines', async () => {
    const tx = useTx(buildTx({ cartSnapshotHash: validHash() }))

    await expect(acceptOfferForCheckout(OFFER_ID)).resolves.toMatchObject({ alreadyAccepted: false })
    expect(tx.offer.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'ACCEPTED' }),
    }))
  })

  test('rejects a tampered binding', async () => {
    const tx = useTx(buildTx({ cartSnapshotHash: 'f'.repeat(64) }))

    await expect(acceptOfferForCheckout(OFFER_ID)).rejects.toThrow('no longer matches the customer-selected basket')
    expect(tx.offer.update).not.toHaveBeenCalled()
  })

  test('rejects a valid signed snapshot when the live basket changed', async () => {
    const tx = useTx(buildTx({ cartSnapshotHash: validHash() }))
    tx.cart.findFirst.mockResolvedValue({ items: [{ productId: PRODUCT, quantity: 3 }] })

    await expect(acceptOfferForCheckout(OFFER_ID)).rejects.toThrow('basket changed after this offer was created')
    expect(tx.offer.update).not.toHaveBeenCalled()
  })

  test('locks the customer before comparing and accepting a bound basket', async () => {
    const tx = useTx(buildTx({ cartSnapshotHash: validHash() }))

    await expect(acceptOfferForCheckout(OFFER_ID)).resolves.toMatchObject({ alreadyAccepted: false })
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1)
    expect(tx.cart.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: CART, customerId: 'customer-1', merchantId: MERCHANT, status: 'ACTIVE' }),
    }))
  })

  test('still verifies the binding when the offer carries a campaign', async () => {
    // The regression this guards: the check used to be skipped entirely for any
    // offer with a campaignId, so attaching a campaign disabled the only tie
    // between an offer and the shopper's real basket.
    const tx = useTx(
      // A perfectly valid, merchant-owned campaign still does not excuse a
      // binding that fails to reproduce.
      buildTx({ campaignId: CAMPAIGN, cartSnapshotHash: 'f'.repeat(64) }, { id: CAMPAIGN }),
    )

    await expect(acceptOfferForCheckout(OFFER_ID)).rejects.toThrow('no longer matches the customer-selected basket')
    expect(tx.offer.update).not.toHaveBeenCalled()
  })

  test('refuses a cart-linked offer that has no binding at all', async () => {
    const tx = useTx(buildTx({ cartSnapshotHash: null, campaignId: null }))

    await expect(acceptOfferForCheckout(OFFER_ID)).rejects.toThrow('missing its verified basket selection')
    expect(tx.offer.update).not.toHaveBeenCalled()
  })

  test('allows a binding-less recovery offer only when the campaign owns the merchant', async () => {
    const owned = useTx(buildTx({ cartSnapshotHash: null, campaignId: CAMPAIGN }, { id: CAMPAIGN }))
    await expect(acceptOfferForCheckout(OFFER_ID)).resolves.toMatchObject({ alreadyAccepted: false })
    expect(owned.campaign.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: CAMPAIGN, merchantId: MERCHANT },
    }))

    // Same shape, but the campaign does not belong to this offer's merchant.
    const foreign = useTx(buildTx({ cartSnapshotHash: null, campaignId: CAMPAIGN }, null))
    await expect(acceptOfferForCheckout(OFFER_ID)).rejects.toThrow('missing its verified basket selection')
    expect(foreign.offer.update).not.toHaveBeenCalled()
  })
})
