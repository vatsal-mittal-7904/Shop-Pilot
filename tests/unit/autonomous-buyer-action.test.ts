import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireCustomer: vi.fn(),
  checkDistributedRateLimit: vi.fn(),
  addProductToCart: vi.fn(),
  createOfferFromActiveCart: vi.fn(),
  acceptOfferForCheckout: vi.fn(),
  createOrReuseCheckoutOrder: vi.fn(),
  prismaMerchantFind: vi.fn(),
  prismaProductFindMany: vi.fn(),
  prismaAuditLogFindFirst: vi.fn(),
}))

vi.mock('@/backend/auth/session', () => ({
  requireCustomer: mocks.requireCustomer,
}))

vi.mock('@/backend/utils/rateLimit', () => ({
  checkDistributedRateLimit: mocks.checkDistributedRateLimit,
}))

vi.mock('@/backend/actions/cart', () => ({
  addProductToCart: mocks.addProductToCart,
}))

vi.mock('@/backend/actions/commerce', () => ({
  createOfferFromActiveCart: mocks.createOfferFromActiveCart,
}))

vi.mock('@/backend/actions/order', () => ({
  acceptOfferForCheckout: mocks.acceptOfferForCheckout,
  createOrReuseCheckoutOrder: mocks.createOrReuseCheckoutOrder,
}))

vi.mock('@/backend/db/prisma', () => ({
  prisma: {
    merchant: { findFirst: mocks.prismaMerchantFind },
    product: { findMany: mocks.prismaProductFindMany },
    auditLog: { findFirst: mocks.prismaAuditLogFindFirst },
  },
}))

import { runAutonomousBuyerAction } from '@/backend/actions/autonomousBuyer'
import { cartSelectionBinding } from '@/backend/utils/cartSelectionBinding'

describe('A2A Autonomous Buyer Agent Action (runAutonomousBuyerAction)', () => {
  const mockUser = {
    id: 'user-a2a-1',
    name: 'Autonomous Shopper',
    email: 'buyer@agentic.ai',
  }

  const mockCustomer = {
    id: 'cust-a2a-1',
    dailySpendLimit: 5000000,
    deliveryProfile: {
      autonomousCheckoutEnabled: true,
      autonomousSpendCeiling: 1000000, // ₹10,000
      maxOrderSpendLimit: 800000, // ₹8,000
    },
  }

  const mockMerchant = {
    id: 'merch-a2a-1',
    name: 'TechNest Store',
  }

  const mockProduct = {
    id: 'prod-kb-1',
    name: 'Custom Mechanical Keyboard RGB',
    category: 'keyboard',
    price: 749900, // ₹7,499
    inventory: 12,
    merchantId: 'merch-a2a-1',
    imageUrl: 'https://example.com/kb.png',
  }

  const mockCart = {
    id: 'cart-a2a-1',
    customerId: 'cust-a2a-1',
    merchantId: 'merch-a2a-1',
    items: [{ id: 'item-1', productId: 'prod-kb-1', quantity: 1, unitPrice: 749900 }],
  }

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.OFFER_BINDING_SECRET = 'mock-secret-at-least-16-chars'
    mocks.checkDistributedRateLimit.mockResolvedValue({ allowed: true })
    mocks.requireCustomer.mockResolvedValue({ user: mockUser, customer: mockCustomer })
    mocks.prismaMerchantFind.mockResolvedValue(mockMerchant)
    mocks.prismaProductFindMany.mockResolvedValue([mockProduct])
    mocks.prismaAuditLogFindFirst.mockResolvedValue({ entryHash: '700d22734df1bb693806f1de43bc1234' })
    mocks.addProductToCart.mockResolvedValue(mockCart)

    const validHash = cartSelectionBinding({
      customerId: mockCustomer.id,
      merchantId: mockMerchant.id,
      cartId: mockCart.id,
      items: [{ productId: mockProduct.id, quantity: 1, unitPrice: mockProduct.price }],
    })

    mocks.createOfferFromActiveCart.mockResolvedValue({
      id: 'offer-a2a-1',
      merchantId: mockMerchant.id,
      customerId: mockCustomer.id,
      total: 749900,
      cartSnapshotHash: validHash,
    })

    mocks.acceptOfferForCheckout.mockResolvedValue({
      offerId: 'offer-a2a-1',
      acceptedAt: new Date(),
    })

    mocks.createOrReuseCheckoutOrder.mockResolvedValue({
      internalOrderId: 'ord-internal-1',
      razorpayOrder: {
        id: 'order_rzp_mock_123',
        amount: 749900,
        currency: 'INR',
        receipt: 'rcpt_a2a_123',
        status: 'created',
      },
    })
  })

  it('rejects execution if autonomous mode is not enabled in customer profile', async () => {
    mocks.requireCustomer.mockResolvedValue({
      user: mockUser,
      customer: {
        ...mockCustomer,
        deliveryProfile: { autonomousCheckoutEnabled: false },
      },
    })

    const result = await runAutonomousBuyerAction({ directive: 'Procure mechanical keyboard' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('Autonomous mode is currently disabled')
    expect(result.steps[0].status).toBe('FAILED')
  })

  it('successfully executes all 7 steps of the A2A commerce lifecycle', async () => {
    const result = await runAutonomousBuyerAction({
      directive: 'Procure mechanical keyboard under ₹8,000 INR',
    })

    expect(result.success).toBe(true)
    expect(result.orderId).toBe('ord-internal-1')
    expect(result.razorpayOrderId).toBe('order_rzp_mock_123')
    expect(result.amountPaise).toBe(749900)
    expect(result.currency).toBe('INR')
    expect(result.skuPurchased?.name).toBe('Custom Mechanical Keyboard RGB')

    // Verify all 7 steps are present and passed
    expect(result.steps).toHaveLength(7)
    expect(result.steps.every((s) => s.status === 'SUCCESS')).toBe(true)

    // Step 1: Policy Assertion
    expect(result.steps[0].step).toBe(1)
    expect(result.steps[0].title).toContain('Identity & Spending Ceiling')

    // Step 2: Discovery
    expect(result.steps[1].step).toBe(2)
    expect(result.steps[1].details.selectedSku).toBe('Custom Mechanical Keyboard RGB')

    // Step 3: Basket
    expect(result.steps[2].step).toBe(3)
    expect(mocks.addProductToCart).toHaveBeenCalledWith(mockProduct.id)

    // Step 4: Offer Generation
    expect(result.steps[3].step).toBe(4)
    expect(mocks.createOfferFromActiveCart).toHaveBeenCalledWith({ merchantId: mockMerchant.id })

    // Step 5: Tamper defense
    expect(result.steps[4].step).toBe(5)
    expect(result.steps[4].details.tamperTest).toContain('Passed')

    // Step 6: Acceptance
    expect(result.steps[5].step).toBe(6)
    expect(mocks.acceptOfferForCheckout).toHaveBeenCalledWith('offer-a2a-1', { isPreAuthorizedAutonomous: true })

    // Step 7: Razorpay creation
    expect(result.steps[6].step).toBe(7)
    expect(mocks.createOrReuseCheckoutOrder).toHaveBeenCalledWith('offer-a2a-1')
  })

  it('fails safely if no matching in-stock products exist within spend ceiling', async () => {
    mocks.prismaProductFindMany.mockResolvedValue([])

    const result = await runAutonomousBuyerAction({ directive: 'Procure expensive server under ₹1,000' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('No candidate products found')
    expect(result.steps[1].status).toBe('FAILED')
  })
})
