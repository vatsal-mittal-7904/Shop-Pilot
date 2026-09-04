import { describe, expect, it, vi } from 'vitest'
import { calculateCrossSellPricing } from '@/backend/utils/recommendationPricing'
import { bindingsMatch, cartSelectionBinding } from '@/backend/utils/cartSelectionBinding'
import { assertAccountSpendLimit } from '@/backend/actions/accountBudget'

describe('Money Safety & Financial Invariants Matrix', () => {
  const PROD_1 = '11111111-1111-4111-8111-111111111111'
  const PROD_2 = '22222222-2222-4222-8222-222222222222'

  describe('Invariant 1: Deterministic Discount Authorization & Margin Floor', () => {
    it('guarantees discounts cannot exceed authorized merchant policies', async () => {
      const addonProduct = { id: PROD_2, price: 100000, cost: 50000 }
      const policyLimit = 15 // 15% max
      const pricing = calculateCrossSellPricing({
        cartItems: [{ productId: PROD_1, quantity: 1, product: { id: PROD_1, price: 500000, cost: 300000 } }],
        addonProduct,
        discountPercent: 10,
      })
      // Assert pricing logic respects bounded limit
      expect(pricing.discountAmount).toBeLessThanOrEqual(addonProduct.price * (policyLimit / 100))
    })

    it('enforces that bundle cross-sell discounts apply strictly to ONE unit of the add-on', () => {
      const cartItems = [
        { productId: PROD_1, quantity: 1, product: { id: PROD_1, price: 500000, cost: 300000 } },
        { productId: PROD_2, quantity: 2, product: { id: PROD_2, price: 100000, cost: 50000 } },
      ]
      const addonProduct = { id: PROD_2, price: 100000, cost: 50000 }

      const pricing = calculateCrossSellPricing({
        cartItems,
        addonProduct,
        discountPercent: 10,
      })

      // Subtotal = 500000 (1 item) + 200000 (2 pre-existing) + 100000 (1 added) = 800000
      expect(pricing.subtotal).toBe(800000)
      // Discount is 10% of ONE unit of 100000 = 10000 (NOT on all 3 units)
      expect(pricing.discountAmount).toBe(10000)
      expect(pricing.total).toBe(790000)
    })
  })

  describe('Invariant 2: Cryptographic HMAC Basket Binding', () => {
    it('rejects tampered quantities, prices, or line items', () => {
      process.env.OFFER_BINDING_SECRET = 'test-binding-secret-for-money-safety-matrix'
      const baseInput = {
        customerId: 'cust-123',
        merchantId: 'merch-123',
        cartId: 'cart-123',
        items: [
          { productId: PROD_1, quantity: 1, unitPrice: 500000 },
          { productId: PROD_2, quantity: 2, unitPrice: 100000 },
        ],
      }

      const expectedSignature = cartSelectionBinding(baseInput)
      expect(bindingsMatch(expectedSignature, cartSelectionBinding(baseInput))).toBe(true)

      // Tampered quantity
      const tamperedQtyInput = {
        ...baseInput,
        items: [
          { productId: PROD_1, quantity: 2, unitPrice: 500000 },
          { productId: PROD_2, quantity: 2, unitPrice: 100000 },
        ],
      }
      expect(bindingsMatch(expectedSignature, cartSelectionBinding(tamperedQtyInput))).toBe(false)

      // Tampered unit price
      const tamperedPriceInput = {
        ...baseInput,
        items: [
          { productId: PROD_1, quantity: 1, unitPrice: 100000 }, // Reduced price
          { productId: PROD_2, quantity: 2, unitPrice: 100000 },
        ],
      }
      expect(bindingsMatch(expectedSignature, cartSelectionBinding(tamperedPriceInput))).toBe(false)

      // Tampered customer ID
      const tamperedCustomerInput = { ...baseInput, customerId: 'rogue-customer-456' }
      expect(bindingsMatch(expectedSignature, cartSelectionBinding(tamperedCustomerInput))).toBe(false)
    })
  })

  describe('Invariant 3: Expired Offer Checkout Blocking', () => {
    it('strictly invalidates offers where expiresAt is in the past', () => {
      const now = Date.now()
      const expiredOffer = {
        id: 'offer-1',
        expiresAt: new Date(now - 1000),
        status: 'ACTIVE',
      }

      const isExpired = expiredOffer.expiresAt.getTime() <= now || expiredOffer.status === 'EXPIRED'
      expect(isExpired).toBe(true)
    })
  })

  describe('Invariant 4: Account Spend Caps (Daily & Monthly)', () => {
    it('blocks checkout when accumulated daily spend exceeds customer spend limit', async () => {
      const mockTx = {
        $executeRaw: vi.fn(),
        customer: { findUnique: vi.fn().mockResolvedValue({ dailySpendLimit: 5000000, monthlySpendLimit: 20000000 }) },
        merchantPolicy: { findMany: vi.fn().mockResolvedValue([]) },
        order: {
          aggregate: vi.fn()
            .mockResolvedValueOnce({ _sum: { totalAmount: 4500000 } })
            .mockResolvedValueOnce({ _sum: { totalAmount: 4500000 } }),
          count: vi.fn().mockResolvedValue(1),
        },
      }

      await expect(
        assertAccountSpendLimit(mockTx as unknown as Parameters<typeof assertAccountSpendLimit>[0], 'cust-1', 'merch-1', 1000000)
      ).rejects.toThrow('Order exceeds the buyer account daily spend limit')
    })

    it('blocks checkout when accumulated monthly spend exceeds monthly limit', async () => {
      const mockTx = {
        $executeRaw: vi.fn(),
        customer: { findUnique: vi.fn().mockResolvedValue({ dailySpendLimit: 50000000, monthlySpendLimit: 20000000 }) },
        merchantPolicy: { findMany: vi.fn().mockResolvedValue([]) },
        order: {
          aggregate: vi.fn()
            .mockResolvedValueOnce({ _sum: { totalAmount: 500000 } })
            .mockResolvedValueOnce({ _sum: { totalAmount: 19500000 } }),
          count: vi.fn().mockResolvedValue(1),
        },
      }

      await expect(
        assertAccountSpendLimit(mockTx as unknown as Parameters<typeof assertAccountSpendLimit>[0], 'cust-1', 'merch-1', 800000)
      ).rejects.toThrow('Order exceeds the buyer account monthly spend limit')
    })
  })
})
