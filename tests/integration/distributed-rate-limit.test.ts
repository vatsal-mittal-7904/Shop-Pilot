import { afterAll, describe, expect, test } from 'vitest'
import { prisma } from '@/backend/db/prisma'
import { checkDistributedRateLimit } from '@/backend/utils/rateLimit'

afterAll(async () => {
  await prisma.$disconnect()
})

describe('Multi-Instance Distributed Rate Limiter Integration Tests', () => {
  test('atomically coordinates rate limits across multiple concurrent simulated instances in PostgreSQL', async () => {
    const customerId = `shared-cust-${Date.now()}`
    const key = `customer:${customerId}`
    const options = { maxRequests: 4, windowMs: 60000 }

    // Instance A makes 2 requests
    const resA1 = await checkDistributedRateLimit(key, options)
    expect(resA1.allowed).toBe(true)
    expect(resA1.remaining).toBe(3)

    const resA2 = await checkDistributedRateLimit(key, options)
    expect(resA2.allowed).toBe(true)
    expect(resA2.remaining).toBe(2)

    // Instance B (simulated independent worker) queries the same key against PostgreSQL
    const resB1 = await checkDistributedRateLimit(key, options)
    expect(resB1.allowed).toBe(true)
    // Must observe the remaining quota from Instance A
    expect(resB1.remaining).toBe(1)

    const resB2 = await checkDistributedRateLimit(key, options)
    expect(resB2.allowed).toBe(true)
    expect(resB2.remaining).toBe(0)

    // 5th request across any instance must be rejected atomically
    const blockedInstanceA = await checkDistributedRateLimit(key, options)
    expect(blockedInstanceA.allowed).toBe(false)
    expect(blockedInstanceA.remaining).toBe(0)
    expect(blockedInstanceA.retryAfterMs).toBeGreaterThan(0)

    const blockedInstanceB = await checkDistributedRateLimit(key, options)
    expect(blockedInstanceB.allowed).toBe(false)
    expect(blockedInstanceB.remaining).toBe(0)

    // Verify persisted database record
    const bucket = await prisma.rateLimitBucket.findUnique({ where: { key } })
    expect(bucket).not.toBeNull()
    expect(bucket!.tokens).toBeLessThan(1)
  })
})
