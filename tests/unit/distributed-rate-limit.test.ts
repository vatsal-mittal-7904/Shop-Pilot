import { describe, expect, it } from 'vitest'
import { checkRateLimit } from '@/backend/utils/rateLimit'

describe('Multi-Instance Distributed Rate Limiter (Token Bucket Unit Tests)', () => {
  it('allows requests within burst capacity and tracks remaining quota', () => {
    const id = `test-user-${Date.now()}`
    const res1 = checkRateLimit(id, { maxRequests: 5, windowMs: 60000 })
    expect(res1.allowed).toBe(true)
    expect(res1.limit).toBe(5)
    expect(res1.remaining).toBe(4)

    const res2 = checkRateLimit(id, { maxRequests: 5, windowMs: 60000 })
    expect(res2.allowed).toBe(true)
    expect(res2.remaining).toBe(3)
  })

  it('denies requests when burst quota is exhausted and computes positive retryAfterMs', () => {
    const id = `test-exhaust-${Date.now()}`
    const options = { maxRequests: 3, windowMs: 30000 }

    for (let i = 0; i < 3; i++) {
      const res = checkRateLimit(id, options)
      expect(res.allowed).toBe(true)
    }

    // 4th request must be rate-limited
    const blocked = checkRateLimit(id, options)
    expect(blocked.allowed).toBe(false)
    expect(blocked.remaining).toBe(0)
    expect(blocked.retryAfterMs).toBeGreaterThan(0)
  })

  it('isolates rate limit quotas across different identifiers', () => {
    const userA = `user-a-${Date.now()}`
    const userB = `user-b-${Date.now()}`
    const options = { maxRequests: 2, windowMs: 60000 }

    checkRateLimit(userA, options)
    checkRateLimit(userA, options)
    const blockedA = checkRateLimit(userA, options)
    expect(blockedA.allowed).toBe(false)

    // User B must still have full quota
    const resB = checkRateLimit(userB, options)
    expect(resB.allowed).toBe(true)
    expect(resB.remaining).toBe(1)
  })
})
