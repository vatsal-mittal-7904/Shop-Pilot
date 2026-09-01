import { describe, expect, test, vi } from 'vitest'
import {
  assertDemoSeedAllowed,
  assertNoDemoAccountsInProduction,
  assertProductionMerchantCredentials,
  DEFAULT_DEMO_MERCHANT_EMAIL,
} from '@/backend/security/demoSafety'

describe('demo deployment safety', () => {
  test('permits demo seeds outside production and rejects them in production', () => {
    expect(() => assertDemoSeedAllowed({ NODE_ENV: 'test' })).not.toThrow()
    expect(() => assertDemoSeedAllowed({ NODE_ENV: 'production' })).toThrow(/disabled in production/)
  })

  test('requires non-demo merchant credentials when the catalog seed runs in production', () => {
    expect(() => assertProductionMerchantCredentials({ NODE_ENV: 'production' })).toThrow(/requires MERCHANT_ADMIN_EMAIL/)
    expect(() => assertProductionMerchantCredentials({
      NODE_ENV: 'production', MERCHANT_ADMIN_EMAIL: DEFAULT_DEMO_MERCHANT_EMAIL, MERCHANT_ADMIN_PASSWORD: 'a-real-secret',
    })).toThrow(/default TechNest demo merchant/)
    expect(() => assertProductionMerchantCredentials({
      NODE_ENV: 'production', MERCHANT_ADMIN_EMAIL: 'owner@example.com', MERCHANT_ADMIN_PASSWORD: 'a-real-secret',
    })).not.toThrow()
  })

  test('blocks production startup if a documented demo account remains', async () => {
    const count = vi.fn().mockResolvedValue(1)
    await expect(assertNoDemoAccountsInProduction({ user: { count } }, { NODE_ENV: 'production' }))
      .rejects.toThrow(/startup blocked/)
    expect(count).toHaveBeenCalledWith(expect.objectContaining({
      where: { email: { in: expect.arrayContaining([DEFAULT_DEMO_MERCHANT_EMAIL]) } },
    }))
  })
})
