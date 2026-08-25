/**
 * Lightweight in-memory sliding-window rate limiter.
 *
 * Hackathon-grade: state lives in a module-level Map, so it resets on
 * redeploy/restart and is NOT shared across serverless instances or
 * multiple Node processes. Good enough to blunt naive token-spam from a
 * single client during a demo; swap for a shared store (Redis/Upstash)
 * before relying on this in a real multi-instance deployment.
 *
 * Deliberately dependency-free and importing nothing from the rest of the
 * app -- it is called before authentication does any database work, so it
 * must not be able to pull a Prisma client (or anything else with an
 * initialization cost) into that path.
 */

const WINDOW_MS = 60_000 // 1 minute
const MAX_REQUESTS_PER_WINDOW = 10

/**
 * Timestamps (ms) of recent requests, keyed by identifier (customerId,
 * or IP as a fallback). Each array holds only timestamps that fall
 * inside the current sliding window -- older ones are pruned on read.
 */
const requestLog = new Map<string, number[]>()

// Periodically forget keys with no recent activity so the map doesn't
// grow unbounded over a long-running process. Not load-bearing for
// correctness -- just housekeeping.
const CLEANUP_INTERVAL_MS = 5 * 60_000
let lastCleanup = Date.now()
function cleanupIfDue(now: number) {
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return
  lastCleanup = now
  for (const [key, timestamps] of requestLog) {
    const recent = timestamps.filter((ts) => now - ts < WINDOW_MS)
    if (recent.length === 0) requestLog.delete(key)
    else requestLog.set(key, recent)
  }
}

export type RateLimitResult = {
  allowed: boolean
  limit: number
  remaining: number
  /** Milliseconds until the oldest request in the window expires. */
  retryAfterMs: number
}

/**
 * Checks and records a request for `identifier` (e.g. customerId or IP).
 * Uses a sliding window: at most `MAX_REQUESTS_PER_WINDOW` requests are
 * allowed in any trailing `WINDOW_MS` period.
 *
 * Only ALLOWED calls are recorded, so a client that keeps hammering while
 * blocked does not push its own window forward and lock itself out for
 * longer than the original minute. Call this once per incoming message,
 * right before doing real work.
 *
 * Note for callers checking more than one bucket per request: each call
 * records against its own key, so a request rejected by a later check has
 * still consumed a slot in the earlier one. See the ordering note in the
 * chat route.
 */
export function checkRateLimit(identifier: string): RateLimitResult {
  const now = Date.now()
  cleanupIfDue(now)

  const timestamps = requestLog.get(identifier) ?? []
  const recent = timestamps.filter((ts) => now - ts < WINDOW_MS)

  if (recent.length >= MAX_REQUESTS_PER_WINDOW) {
    const oldest = recent[0]
    requestLog.set(identifier, recent)
    return {
      allowed: false,
      limit: MAX_REQUESTS_PER_WINDOW,
      remaining: 0,
      retryAfterMs: Math.max(0, WINDOW_MS - (now - oldest)),
    }
  }

  recent.push(now)
  requestLog.set(identifier, recent)
  return {
    allowed: true,
    limit: MAX_REQUESTS_PER_WINDOW,
    remaining: MAX_REQUESTS_PER_WINDOW - recent.length,
    retryAfterMs: 0,
  }
}

/**
 * Best-effort client IP extraction for environments (Vercel, most
 * reverse proxies) that set x-forwarded-for / x-real-ip. Falls back to
 * a constant so unattributed requests still share a (coarser) bucket
 * instead of bypassing the limiter entirely.
 *
 * Both headers are client-controllable if no trusted proxy overwrites
 * them, so this is a spam-blunting heuristic, not an identity claim --
 * which is why the chat route keys primarily on the authenticated
 * customerId and treats this only as a secondary bucket.
 */
export function getClientIp(req: Request): string {
  const forwardedFor = req.headers.get('x-forwarded-for')
  if (forwardedFor) {
    // x-forwarded-for can be a comma-separated list; the first entry is
    // the original client.
    return forwardedFor.split(',')[0].trim()
  }
  const realIp = req.headers.get('x-real-ip')
  if (realIp) return realIp.trim()
  return 'unknown'
}
