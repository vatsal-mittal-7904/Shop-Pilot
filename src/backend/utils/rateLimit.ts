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
/**
 * Determines if an IP address is a private, loopback, or carrier-grade NAT address.
 */
function isPrivateIp(ip: string): boolean {
  if (ip === '::1' || ip === '127.0.0.1') return true
  // IPv4 Private Ranges (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 100.64.0.0/10)
  if (/^(10\.|192\.168\.|100\.(6[4-9]|[7-9]\d|1[0-2]\d)\.)/.test(ip)) return true
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)) return true
  // IPv6 Unique Local Address (fc00::/7) and Link-Local (fe80::/10)
  if (/^f[cd][0-9a-f]{2}:/i.test(ip) || /^fe8[0-9a-f]:/i.test(ip)) return true
  return false
}

export function getClientIp(req: Request): string {
  // 1. Immutable Edge Proxy Headers (Highest Trust)
  // Vercel and Cloudflare overwrite these at the edge, preventing client spoofing.
  const vercelForwarded = req.headers.get('x-vercel-forwarded-for')
  if (vercelForwarded) return vercelForwarded.trim()

  const cfConnecting = req.headers.get('cf-connecting-ip')
  if (cfConnecting) return cfConnecting.trim()

  // 2. X-Forwarded-For with Strict Right-To-Left Parsing
  // Attackers can append spoofed IPs to the left (e.g. "8.8.8.8, 1.2.3.4").
  // The right-most IPs are appended by our own load balancers/proxies.
  const forwardedFor = req.headers.get('x-forwarded-for')
  if (forwardedFor) {
    const ips = forwardedFor.split(',').map(ip => ip.trim()).filter(Boolean)
    // Scan right to left. The first IP that is NOT a private internal IP is the true client.
    for (let i = ips.length - 1; i >= 0; i--) {
      if (!isPrivateIp(ips[i])) {
        return ips[i]
      }
    }
  }

  // 3. X-Real-IP
  const realIp = req.headers.get('x-real-ip')
  if (realIp && !isPrivateIp(realIp.trim())) return realIp.trim()

  return 'unknown'
}
