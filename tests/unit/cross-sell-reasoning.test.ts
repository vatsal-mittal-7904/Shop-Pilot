import { describe, expect, it } from 'vitest'
import { calculateCrossSellPricing, calculateUpsellPricing } from '@/backend/utils/recommendationPricing'

describe('Context-Aware Cross-Sell and Upsell Reasoning', () => {
  const KEYBOARD_ID = '11111111-1111-4111-8111-111111111111'
  const DESK_MAT_ID = '22222222-2222-4222-8222-222222222222'
  const PRO_KEYBOARD_ID = '33333333-3333-4333-8333-333333333333'

  it('computes accurate cross-sell bundle margins and inventory reasoning', () => {
    const keyboard = { id: KEYBOARD_ID, price: 699900, cost: 400000, category: 'Peripherals' }
    const deskMat = { id: DESK_MAT_ID, price: 149900, cost: 60000, category: 'Accessories', inventory: 35 }

    const pricing = calculateCrossSellPricing({
      cartItems: [{ productId: KEYBOARD_ID, quantity: 1, product: keyboard }],
      addonProduct: deskMat,
      discountPercent: 10,
    })

    const totalCost = keyboard.cost + deskMat.cost // 460000
    const grossMarginPercent = Math.round(((pricing.total - totalCost) / pricing.total) * 100)

    const reasoning = {
      categoryMatch: `${keyboard.category} & ${deskMat.category} synergy`,
      inventoryDepth: `${deskMat.inventory} units in stock`,
      marginHealth: `${grossMarginPercent}% gross margin preserved`,
      compatibilityReason: `Selected ${deskMat.id} to complement ${keyboard.id} due to direct category compatibility and high inventory depth.`,
    }

    expect(pricing.subtotal).toBe(849800)
    expect(pricing.discountAmount).toBe(14990)
    expect(pricing.total).toBe(834810)
    expect(grossMarginPercent).toBe(45)
    expect(reasoning.categoryMatch).toContain('Peripherals & Accessories')
    expect(reasoning.marginHealth).toContain('45% gross margin')
  })

  it('computes accurate upsell upgrade delta and margin retention reasoning', () => {
    const baseKeyboard = { id: KEYBOARD_ID, name: 'Standard Keyboard', price: 499900, cost: 280000 }
    const proKeyboard = { id: PRO_KEYBOARD_ID, name: 'Pro Keyboard', price: 799900, cost: 420000, inventory: 20 }

    const pricing = calculateUpsellPricing({
      cartItems: [{ productId: KEYBOARD_ID, quantity: 1, product: baseKeyboard }],
      originalProduct: baseKeyboard,
      upgradeProduct: proKeyboard,
      discountPercent: 10,
    })

    const grossMarginPercent = Math.round(((pricing.total - proKeyboard.cost) / pricing.total) * 100)
    const upgradeDeltaRupees = Math.round((proKeyboard.price - baseKeyboard.price) / 100)

    const reasoning = {
      upgradeDelta: `Upgrade from ${baseKeyboard.name} (+₹${upgradeDeltaRupees.toLocaleString('en-IN')})`,
      inventoryDepth: `${proKeyboard.inventory} units in stock`,
      marginHealth: `${grossMarginPercent}% gross margin preserved`,
      compatibilityReason: `Upgraded to ${proKeyboard.name} for superior performance while keeping gross margin at ${grossMarginPercent}%.`,
    }

    expect(pricing.subtotal).toBe(799900)
    expect(pricing.discountAmount).toBe(79990)
    expect(pricing.total).toBe(719910)
    expect(grossMarginPercent).toBe(42)
    expect(reasoning.upgradeDelta).toBe('Upgrade from Standard Keyboard (+₹3,000)')
    expect(reasoning.marginHealth).toBe('42% gross margin preserved')
  })
})
