/**
 * MerchantOS Abuse & Spam Defense Detector
 *
 * Implements progressive abuse scoring, rapid-fire spam detection, and
 * quarantine cooldowns for offending client IPs or customer sessions.
 */

interface ClientAbuseRecord {
  requestTimestamps: number[]
  violationCount: number
  quarantinedUntil: number | null
}

const clientRecords = new Map<string, ClientAbuseRecord>()

// Clean up memory cache periodically (every 10 minutes)
setInterval(() => {
  const now = Date.now()
  for (const [key, record] of clientRecords.entries()) {
    // Drop records that have been idle for > 30 minutes
    const lastRequest = record.requestTimestamps[record.requestTimestamps.length - 1] || 0
    if (now - lastRequest > 30 * 60 * 1000 && (!record.quarantinedUntil || now > record.quarantinedUntil)) {
      clientRecords.delete(key)
    }
  }
}, 10 * 60 * 1000).unref?.()

export interface AbuseCheckOptions {
  maxRequestsPerMinute?: number
  burstWindowMs?: number
  baseCooldownSeconds?: number
}

export interface AbuseCheckResult {
  isAllowed: boolean
  isQuarantined: boolean
  currentVelocity: number
  retryAfterSeconds?: number
  reason?: string
}

/**
 * Evaluates whether a client key (IP or customer ID) is allowed to proceed or should be quarantined.
 */
export function checkAbuseAndSpam(key: string, options: AbuseCheckOptions = {}): AbuseCheckResult {
  const maxRequestsPerMinute = options.maxRequestsPerMinute ?? 40
  const burstWindowMs = options.burstWindowMs ?? 60_000
  const baseCooldownSeconds = options.baseCooldownSeconds ?? 60
  const now = Date.now()

  let record = clientRecords.get(key)
  if (!record) {
    record = {
      requestTimestamps: [],
      violationCount: 0,
      quarantinedUntil: null,
    }
    clientRecords.set(key, record)
  }

  // 1. Check if currently in quarantine cooldown
  if (record.quarantinedUntil && now < record.quarantinedUntil) {
    const remainingSeconds = Math.ceil((record.quarantinedUntil - now) / 1000)
    return {
      isAllowed: false,
      isQuarantined: true,
      currentVelocity: record.requestTimestamps.length,
      retryAfterSeconds: remainingSeconds,
      reason: `Client is temporarily quarantined due to automated spam velocity. Retry in ${remainingSeconds}s.`,
    }
  }

  // 2. Prune timestamps older than burst window
  const windowStart = now - burstWindowMs
  record.requestTimestamps = record.requestTimestamps.filter((ts) => ts > windowStart)
  record.requestTimestamps.push(now)

  // 3. Check for velocity limit violation
  if (record.requestTimestamps.length > maxRequestsPerMinute) {
    record.violationCount += 1
    // Progressive cooldown: baseCooldown * (2 ^ (violations - 1)) up to max 1 hour
    const penaltyMultiplier = Math.min(Math.pow(2, record.violationCount - 1), 60)
    const cooldownMs = baseCooldownSeconds * 1000 * penaltyMultiplier
    record.quarantinedUntil = now + cooldownMs

    const retryAfter = Math.ceil(cooldownMs / 1000)
    return {
      isAllowed: false,
      isQuarantined: true,
      currentVelocity: record.requestTimestamps.length,
      retryAfterSeconds: retryAfter,
      reason: `Velocity limit exceeded (${record.requestTimestamps.length} reqs/min). Quarantined for ${retryAfter}s.`,
    }
  }

  return {
    isAllowed: true,
    isQuarantined: false,
    currentVelocity: record.requestTimestamps.length,
  }
}

/**
 * Resets abuse record for a key (useful for testing or administrative unbanning).
 */
export function resetAbuseRecord(key: string): void {
  clientRecords.delete(key)
}
