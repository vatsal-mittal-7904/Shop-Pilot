import { describe, expect, it } from 'vitest'
import {
  productRelationshipListSchema,
  productRelationshipPayloadSchema,
} from '@/backend/validators/productRelationship'
import {
  calculateCrossSellPricing,
  calculateUpsellPricing,
} from '@/backend/utils/recommendationPricing'

describe('Product Relationship Validation & Recommendation Pricing', () => {
  const PROD_1 = '11111111-1111-4111-8111-111111111111'
  const PROD_2 = '22222222-2222-4222-8222-222222222222'
  const PROD_3 = '33333333-3333-4333-8333-333333333333'

  describe('productRelationshipListSchema', () => {
    it('accepts valid unique UUID product IDs', () => {
      const valid = [PROD_1, PROD_2, PROD_3]
      expect(() => productRelationshipListSchema.parse(valid)).not.toThrow()
    })

    it('rejects duplicate product IDs in relationship list', () => {
      const duplicates = [PROD_1, PROD_2, PROD_1]
      expect(() => productRelationshipListSchema.parse(duplicates)).toThrow('Duplicate product IDs are not allowed')
    })
  })

  describe('productRelationshipPayloadSchema', () => {
    it('rejects self-referencing product relationships', () => {
      const invalid = {
        sourceProductId: PROD_1,
        relatedProductIds: [PROD_2, PROD_1],
      }
      expect(() => productRelationshipPayloadSchema.parse(invalid)).toThrow('Product cannot be related to itself')
    })

    it('accepts valid payload where source is not in related list', () => {
      const valid = {
        sourceProductId: PROD_1,
        relatedProductIds: [PROD_2, PROD_3],
      }
      expect(() => productRelationshipPayloadSchema.parse(valid)).not.toThrow()
    })
  })

  describe('calculateCrossSellPricing', () => {
    it('correctly computes discounted bundle pricing for cross-sell add-on', () => {
      const cartItems = [
        { productId: PROD_1, quantity: 1, product: { id: PROD_1, price: 500000, cost: 300000 } },
      ]
      const addonProduct = { id: PROD_2, price: 100000, cost: 50000 }
      const discountPercent = 10

      const result = calculateCrossSellPricing({
        cartItems,
        addonProduct,
        discountPercent,
      })

      expect(result.subtotal).toBe(600000)
      expect(result.discountAmount).toBe(10000) // 10% of 100000
      expect(result.total).toBe(590000)
      expect(result.offerItems).toHaveLength(2)
    })
  })

  describe('calculateUpsellPricing', () => {
    it('correctly computes upgrade pricing replacing base item with upgrade item', () => {
      const cartItems = [
        { productId: PROD_1, quantity: 1, product: { id: PROD_1, price: 500000, cost: 300000 } },
      ]
      const originalProduct = { id: PROD_1, price: 500000, cost: 300000 }
      const upgradeProduct = { id: PROD_3, price: 800000, cost: 450000 }
      const discountPercent = 15

      const result = calculateUpsellPricing({
        cartItems,
        originalProduct,
        upgradeProduct,
        discountPercent,
      })

      expect(result.subtotal).toBe(800000)
      expect(result.discountAmount).toBe(120000) // 15% of 800000
      expect(result.total).toBe(680000)
      expect(result.offerItems).toHaveLength(1)
      expect(result.offerItems[0].productId).toBe(PROD_3)
    })
  })
})
