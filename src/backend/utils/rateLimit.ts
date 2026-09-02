/**
 * Multi-Instance Safe Distributed Rate Limiter
 *
 * Tier 1: Upstash Redis (Edge-Ready, Serverless-Safe Sliding Window)
 * Tier 2: In-Memory Sliding Window (Resilient Fallback if Redis is missing/offline)
 *
 * Guarantees that horizontally scaled processes, multi-container deployments,
 * and serverless workers share a single distributed rate limit store, without
 * exhausting PostgreSQL connections.
 */

import { Redis } from '@upstash/redis'
import { Ratelimit } from '@upstash/ratelimit'

const DEFAULT_WINDOW_MS = 60_000 // 1 minute
const DEFAULT_MAX_REQUESTS = 10 // 10 requests per minute

export type RateLimitResult = {
  allowed: boolean
  limit: number
  remaining: number
  /** Milliseconds until sufficient tokens refill for the next request. */
  retryAfterMs: number
}

export type RateLimitOptions = {
  maxRequests?: number
  windowMs?: number
}

// In-memory fallback map for offline mode or test mocks
const inMemoryRequestLog = new Map<string, number[]>()

function checkInMemoryRateLimit(
  identifier: string,
  maxRequests = DEFAULT_MAX_REQUESTS,
  windowMs = DEFAULT_WINDOW_MS
): RateLimitResult {
  const now = Date.now()
  const timestamps = inMemoryRequestLog.get(identifier) ?? []
  const recent = timestamps.filter((ts) => now - ts < windowMs)

  if (recent.length >= maxRequests) {
    const oldest = recent[0]
    inMemoryRequestLog.set(identifier, recent)
    return {
      allowed: false,
      limit: maxRequests,
      remaining: 0,
      retryAfterMs: Math.max(0, windowMs - (now - oldest)),
    }
  }

  recent.push(now)
  inMemoryRequestLog.set(identifier, recent)
  return {
    allowed: true,
    limit: maxRequests,
    remaining: maxRequests - recent.length,
    retryAfterMs: 0,
  }
}

// Singleton for Redis so we don't reconnect constantly
let redis: Redis | null = null

// Cache Ratelimit instances by rule (window-limit)
const ratelimitCache = new Map<string, Ratelimit>()
// Ephemeral cache for Upstash to reduce latency by caching hits locally
const upstashEphemeralCache = new Map()

function getRatelimit(maxRequests: number, windowSeconds: number): Ratelimit | null {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    return null
  }
  
  if (!redis) {
    redis = Redis.fromEnv()
  }
  
  const cacheKey = `${maxRequests}-${windowSeconds}`
  if (!ratelimitCache.has(cacheKey)) {
    const limiter = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(maxRequests, `${windowSeconds} s`),
      ephemeralCache: upstashEphemeralCache,
    })
    ratelimitCache.set(cacheKey, limiter)
  }
  
  return ratelimitCache.get(cacheKey)!
}

export async function checkDistributedRateLimit(
  identifier: string,
  options?: RateLimitOptions
): Promise<RateLimitResult> {
  const maxRequests = options?.maxRequests ?? DEFAULT_MAX_REQUESTS
  const windowMs = options?.windowMs ?? DEFAULT_WINDOW_MS
  
  const windowSeconds = Math.max(1, Math.floor(windowMs / 1000))
  const limiter = getRatelimit(maxRequests, windowSeconds)

  if (limiter) {
    try {
      const { success, limit, remaining, reset } = await limiter.limit(identifier)
      return {
        allowed: success,
        limit,
        remaining,
        retryAfterMs: success ? 0 : Math.max(0, reset - Date.now()),
      }
    } catch (error) {
      console.warn('[RATE_LIMIT] Upstash Redis failed, falling back to in-memory', error)
      return checkInMemoryRateLimit(identifier, maxRequests, windowMs)
    }
  }

  // Fallback to in-memory if Upstash isn't configured (e.g. local dev, CI/CD)
  return checkInMemoryRateLimit(identifier, maxRequests, windowMs)
}

/**
 * Synchronous in-memory rate limiter for local synchronous operations or fallback.
 */
export function checkRateLimit(
  identifier: string,
  options?: RateLimitOptions
): RateLimitResult {
  return checkInMemoryRateLimit(
    identifier,
    options?.maxRequests ?? DEFAULT_MAX_REQUESTS,
    options?.windowMs ?? DEFAULT_WINDOW_MS
  )
}

/**
 * Best-effort client IP extraction for reverse proxies and load balancers.
 */
export function getClientIp(req: Request): string {
  const forwardedFor = req.headers.get('x-forwarded-for')
  if (forwardedFor) {
    const first = forwardedFor.split(',')[0].trim()
    if (first) return first
  }
  const realIp = req.headers.get('x-real-ip')
  if (realIp) return realIp.trim()
  return 'unknown'
}
