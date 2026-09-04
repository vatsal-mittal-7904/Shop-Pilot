import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { validateEnv } from '@/backend/utils/env'

describe('Environment Configuration Guard (env.ts)', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
    // Ensure test environment does not trigger process.exit
    process.env.NODE_ENV = 'test'
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('successfully validates a compliant demo configuration', () => {
    process.env.APP_ENV = 'demo'
    process.env.DATABASE_URL = 'postgres://postgres:postgres@localhost:5432/testdb'
    process.env.OFFER_BINDING_SECRET = 'sixteen_chars_minimum_secret_123'
    process.env.AUDIT_HMAC_SECRET = 'sixteen_chars_minimum_secret_456'
    process.env.RAZORPAY_KEY_ID = 'rzp_test_validKey123'

    const config = validateEnv()
    expect(config.APP_ENV).toBe('demo')
    expect(config.OFFER_BINDING_SECRET).toBe('sixteen_chars_minimum_secret_123')
  })

  it('rejects short OFFER_BINDING_SECRET (< 16 chars)', () => {
    process.env.DATABASE_URL = 'postgres://localhost/test'
    process.env.OFFER_BINDING_SECRET = 'too_short'
    process.env.AUDIT_HMAC_SECRET = 'sixteen_chars_minimum_secret_456'

    expect(() => validateEnv()).toThrow(/Environment validation failed/)
  })

  it('forbids live Razorpay credentials in demo mode', () => {
    process.env.APP_ENV = 'demo'
    process.env.DATABASE_URL = 'postgres://localhost/test'
    process.env.OFFER_BINDING_SECRET = 'sixteen_chars_minimum_secret_123'
    process.env.AUDIT_HMAC_SECRET = 'sixteen_chars_minimum_secret_456'
    process.env.RAZORPAY_KEY_ID = 'rzp_live_forbiddenInDemo123'

    expect(() => validateEnv()).toThrow(/Live Razorpay credentials are forbidden in demo mode/)
  })

  it('requires Razorpay credentials in production mode', () => {
    process.env.APP_ENV = 'production'
    process.env.DATABASE_URL = 'postgres://localhost/test'
    process.env.OFFER_BINDING_SECRET = 'sixteen_chars_minimum_secret_123'
    process.env.AUDIT_HMAC_SECRET = 'sixteen_chars_minimum_secret_456'
    delete process.env.RAZORPAY_KEY_ID
    delete process.env.RAZORPAY_KEY_SECRET
    delete process.env.RAZORPAY_WEBHOOK_SECRET

    expect(() => validateEnv()).toThrow(/Razorpay credentials are required in production/)
  })
})
