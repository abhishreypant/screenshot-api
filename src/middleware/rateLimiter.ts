// =============================================================================
// RATE LIMITER MIDDLEWARE - Sliding window rate limiting.
//
// Why sliding window?
// - Fixed window has the "boundary problem" (10 requests at 11:59, 10 more at 12:01)
// - Sliding window distributes the limit more evenly
//
// Implementation: Track request timestamps, count those within window.
// Trade-off: Slightly more memory than fixed window counter.
// =============================================================================

import type { Context, Next } from 'hono'
import { config } from '../config.js'
import type { RateLimitEntry, ApiErrorResponse } from '../types/index.js'

/**
 * In-memory rate limit store.
 * Key = IP address
 * Value = Array of request timestamps
 *
 * In production: Use Redis with ZRANGEBYSCORE for sliding window.
 */
const rateLimitStore = new Map<string, number[]>()

/**
 * Get client IP from request.
 * Handles proxy headers (X-Forwarded-For) for deployments behind reverse proxy.
 */
function getClientIp(c: Context): string {
  // Try X-Forwarded-For first (when behind proxy/load balancer)
  const forwarded = c.req.header('x-forwarded-for')
  if (forwarded) {
    // X-Forwarded-For can be comma-separated, first one is the client
    return forwarded.split(',')[0].trim()
  }

  // Try X-Real-IP (nginx)
  const realIp = c.req.header('x-real-ip')
  if (realIp) {
    return realIp
  }

  // Fallback to direct connection (development)
  // Hono doesn't expose raw socket, so we use a placeholder
  return 'unknown'
}

/**
 * Clean up old timestamps from an entry.
 * Returns timestamps within the current window.
 */
function cleanupTimestamps(timestamps: number[], windowStart: number): number[] {
  return timestamps.filter((ts) => ts > windowStart)
}

/**
 * Check rate limit for a client.
 * Returns remaining requests and reset time.
 */
function checkRateLimit(ip: string): {
  allowed: boolean
  remaining: number
  resetIn: number
} {
  const now = Date.now()
  const windowStart = now - config.rateLimit.windowMs

  // Get existing timestamps or empty array
  let timestamps = rateLimitStore.get(ip) || []

  // Clean up old timestamps
  timestamps = cleanupTimestamps(timestamps, windowStart)

  const count = timestamps.length
  const remaining = Math.max(0, config.rateLimit.maxRequests - count)
  const allowed = count < config.rateLimit.maxRequests

  // Calculate reset time (when oldest request expires)
  let resetIn = config.rateLimit.windowMs
  if (timestamps.length > 0) {
    const oldestTimestamp = Math.min(...timestamps)
    resetIn = oldestTimestamp + config.rateLimit.windowMs - now
  }

  return { allowed, remaining, resetIn }
}

/**
 * Record a request for rate limiting.
 */
function recordRequest(ip: string): void {
  const now = Date.now()
  const windowStart = now - config.rateLimit.windowMs

  let timestamps = rateLimitStore.get(ip) || []
  timestamps = cleanupTimestamps(timestamps, windowStart)
  timestamps.push(now)

  rateLimitStore.set(ip, timestamps)
}

/**
 * Rate limiter middleware for Hono.
 *
 * Usage: app.use('/screenshot', rateLimiter)
 */
export async function rateLimiter(c: Context, next: Next): Promise<Response | void> {
  const ip = getClientIp(c)
  const { allowed, remaining, resetIn } = checkRateLimit(ip)

  // Set rate limit headers (useful for clients)
  c.header('X-RateLimit-Limit', String(config.rateLimit.maxRequests))
  c.header('X-RateLimit-Remaining', String(remaining))
  c.header('X-RateLimit-Reset', String(Math.ceil(resetIn / 1000)))

  if (!allowed) {
    const resetMinutes = Math.ceil(resetIn / 60000)
    const response: ApiErrorResponse = {
      success: false,
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: `You've exceeded ${config.rateLimit.maxRequests} requests per hour. Try again in ${resetMinutes} minute${resetMinutes === 1 ? '' : 's'}.`,
        retryAfter: Math.ceil(resetIn / 1000),
      },
    }

    return c.json(response, 429)
  }

  // Record this request
  recordRequest(ip)

  await next()
}

/**
 * Get current rate limit status for an IP.
 * Useful for debugging/monitoring.
 */
export function getRateLimitStatus(ip: string): {
  count: number
  remaining: number
  resetIn: number
} {
  const { remaining, resetIn } = checkRateLimit(ip)
  const timestamps = rateLimitStore.get(ip) || []
  const windowStart = Date.now() - config.rateLimit.windowMs
  const validTimestamps = cleanupTimestamps(timestamps, windowStart)

  return {
    count: validTimestamps.length,
    remaining,
    resetIn,
  }
}

/**
 * Clear rate limit for an IP.
 * Useful for testing or manual override.
 */
export function clearRateLimit(ip: string): void {
  rateLimitStore.delete(ip)
}

/**
 * Clear all rate limits.
 */
export function clearAllRateLimits(): void {
  rateLimitStore.clear()
}
