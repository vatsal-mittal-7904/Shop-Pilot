import { describe, expect, it, vi, beforeEach } from 'vitest'
import { calculateCrossSellPricing } from '@/backend/utils/recommendationPricing'
import type { Product, Merchant, User } from '@prisma/client'

// Mock dependencies for testing merchant actions in isolation
vi.mock('@/backend/auth/session', () => ({
  requireMerchant: vi.fn(),
}))

vi.mock('@/backend/db/prisma', () => ({
  prisma: {
    product: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
  },
}))

import { requireMerchant } from '@/backend/auth/session'
import { prisma } from '@/backend/db/prisma'
import { addBundleOption, removeBundleOption } from '@/backend/actions/merchant'

describe('Merchant Bundle Options & Merchandising', () => {
  const MERCHANT_ID = 'merchant-1111'
  const USER_ID = 'user-1111'
  const KB_ID = 'kb-2222'
  const WRIST_REST_ID = 'wrist-rest-3333'
  const UPGRADE_KB_ID = 'pro-kb-4444'

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireMerchant).mockResolvedValue({
      user: { id: USER_ID, email: 'merchant@technest.com', role: 'MERCHANT' } as unknown as User,
      merchant: { id: MERCHANT_ID, name: 'TechNest' } as unknown as Merchant,
    })
  })

  describe('addBundleOption', () => {
    it('successfully pairs complementary bundle add-on and emits audit log', async () => {
      vi.mocked(prisma.product.findUnique)
        .mockResolvedValueOnce({
          id: KB_ID,
          merchantId: MERCHANT_ID,
          name: 'Mechanical Keyboard',
          complementaryProducts: [],
          upgradeProducts: [],
        } as unknown as Product)
        .mockResolvedValueOnce({
          id: WRIST_REST_ID,
          merchantId: MERCHANT_ID,
          name: 'Ergonomic Wrist Rest',
          inventory: 20,
        } as unknown as Product)

      vi.mocked(prisma.product.update).mockResolvedValueOnce({
        id: KB_ID,
        complementaryProducts: [WRIST_REST_ID],
      } as unknown as Product)

      const result = await addBundleOption(KB_ID, WRIST_REST_ID)

      expect(prisma.product.update).toHaveBeenCalledWith({
        where: { id: KB_ID, merchantId: MERCHANT_ID },
        data: { complementaryProducts: [WRIST_REST_ID] },
      })
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          merchantId: MERCHANT_ID,
          actorUserId: USER_ID,
          action: 'BUNDLE_OPTION_CREATED',
          status: 'EXECUTED',
        }),
      })
      expect(result.complementaryProducts).toContain(WRIST_REST_ID)
    })

    it('rejects self-bundling (bundling product with itself)', async () => {
      await expect(addBundleOption(KB_ID, KB_ID)).rejects.toThrow('A product cannot be bundled with itself')
      expect(prisma.product.update).not.toHaveBeenCalled()
    })

    it('rejects bundling an out-of-stock accessory', async () => {
      vi.mocked(prisma.product.findUnique)
        .mockResolvedValueOnce({
          id: KB_ID,
          merchantId: MERCHANT_ID,
          name: 'Mechanical Keyboard',
          complementaryProducts: [],
        } as unknown as Product)
        .mockResolvedValueOnce({
          id: WRIST_REST_ID,
          merchantId: MERCHANT_ID,
          name: 'Ergonomic Wrist Rest',
          inventory: 0,
        } as unknown as Product)

      await expect(addBundleOption(KB_ID, WRIST_REST_ID)).rejects.toThrow('Cannot bundle an out-of-stock product')
      expect(prisma.product.update).not.toHaveBeenCalled()
    })

    it('rejects bundling an upgrade product as a cross-sell add-on', async () => {
      vi.mocked(prisma.product.findUnique)
        .mockResolvedValueOnce({
          id: KB_ID,
          merchantId: MERCHANT_ID,
          name: 'Mechanical Keyboard',
          complementaryProducts: [],
          upgradeProducts: [UPGRADE_KB_ID],
        } as unknown as Product)
        .mockResolvedValueOnce({
          id: UPGRADE_KB_ID,
          merchantId: MERCHANT_ID,
          name: 'Pro Mechanical Keyboard',
          inventory: 10,
        } as unknown as Product)

      await expect(addBundleOption(KB_ID, UPGRADE_KB_ID)).rejects.toThrow('Upgrade products cannot be bundled as cross-sell add-ons')
      expect(prisma.product.update).not.toHaveBeenCalled()
    })
  })

  describe('removeBundleOption', () => {
    it('removes bundle option and logs audit entry', async () => {
      vi.mocked(prisma.product.findUnique).mockResolvedValueOnce({
        id: KB_ID,
        merchantId: MERCHANT_ID,
        name: 'Mechanical Keyboard',
        complementaryProducts: [WRIST_REST_ID, 'other-item'],
      } as unknown as Product)

      vi.mocked(prisma.product.update).mockResolvedValueOnce({
        id: KB_ID,
        complementaryProducts: ['other-item'],
      } as unknown as Product)

      const result = await removeBundleOption(KB_ID, WRIST_REST_ID)

      expect(prisma.product.update).toHaveBeenCalledWith({
        where: { id: KB_ID, merchantId: MERCHANT_ID },
        data: { complementaryProducts: ['other-item'] },
      })
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          merchantId: MERCHANT_ID,
          actorUserId: USER_ID,
          action: 'BUNDLE_OPTION_REMOVED',
        }),
      })
      expect(result.complementaryProducts).not.toContain(WRIST_REST_ID)
    })
  })

  describe('Bundle Pricing & Margin Math', () => {
    it('applies policy discount to bundle accessory and preserves healthy floor margin', () => {
      const keyboard = { id: KB_ID, price: 749900, cost: 449900 }
      const wristRest = { id: WRIST_REST_ID, price: 149900, cost: 59900 }
      const discountPercent = 10

      const pricing = calculateCrossSellPricing({
        cartItems: [{ productId: KB_ID, quantity: 1, product: keyboard }],
        addonProduct: wristRest,
        discountPercent,
      })

      const expectedDiscount = Math.floor(149900 * 0.10) // 14990 paise
      const expectedTotal = 749900 + (149900 - expectedDiscount) // 884810 paise
      const totalCost = keyboard.cost + wristRest.cost // 509800 paise
      const grossMarginPercent = Math.round(((pricing.total - totalCost) / pricing.total) * 100)

      expect(pricing.subtotal).toBe(899800)
      expect(pricing.discountAmount).toBe(expectedDiscount)
      expect(pricing.total).toBe(expectedTotal)
      expect(grossMarginPercent).toBe(42) // Well above 8% policy minimum
      expect(grossMarginPercent).toBeGreaterThanOrEqual(8)
    })
  })
})
