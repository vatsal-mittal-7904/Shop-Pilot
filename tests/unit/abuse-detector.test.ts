import { beforeEach, describe, expect, it } from 'vitest'
import { checkAbuseAndSpam, resetAbuseRecord } from '@/backend/security/abuseDetector'

describe('Abuse & Spam Defense Detector', () => {
  const clientKey = 'ip:192.168.1.100'

  beforeEach(() => {
    resetAbuseRecord(clientKey)
  })

  it('allows normal traffic within rate limit velocity', () => {
    for (let i = 0; i < 10; i++) {
      const result = checkAbuseAndSpam(clientKey, { maxRequestsPerMinute: 20 })
      expect(result.isAllowed).toBe(true)
      expect(result.isQuarantined).toBe(false)
    }
  })

  it('quarantines client when request velocity exceeds limits', () => {
    for (let i = 0; i < 5; i++) {
      checkAbuseAndSpam(clientKey, { maxRequestsPerMinute: 5, baseCooldownSeconds: 60 })
    }

    // 6th request triggers quarantine cooldown
    const overflowResult = checkAbuseAndSpam(clientKey, { maxRequestsPerMinute: 5, baseCooldownSeconds: 60 })
    expect(overflowResult.isAllowed).toBe(false)
    expect(overflowResult.isQuarantined).toBe(true)
    expect(overflowResult.retryAfterSeconds).toBeGreaterThan(0)
    expect(overflowResult.reason).toContain('Velocity limit exceeded')

    // Subsequent immediate request remains quarantined
    const blockedResult = checkAbuseAndSpam(clientKey, { maxRequestsPerMinute: 5, baseCooldownSeconds: 60 })
    expect(blockedResult.isAllowed).toBe(false)
    expect(blockedResult.isQuarantined).toBe(true)
  })
})
