// =============================================================================
// CACHE SERVICE - In-memory cache with TTL.
//
// Why in-memory?
// - Zero infrastructure for personal use
// - Microsecond lookups
// - Good enough for single-server deployment
//
// Trade-off: Lost on restart, not shared across instances.
// Migration path: Same interface, swap to Redis implementation.
// =============================================================================

import type { CacheEntry, ScreenshotMetadata } from '../types/index.js'
import { config } from '../config.js'

/**
 * In-memory cache store.
 * Key = cache key (hash of request)
 * Value = CacheEntry containing screenshot metadata
 */
const cache = new Map<string, CacheEntry<ScreenshotMetadata>>()

/**
 * Store data in cache with TTL.
 */
export function setCache(key: string, data: ScreenshotMetadata): void {
  const now = Date.now()
  cache.set(key, {
    data,
    createdAt: now,
    expiresAt: now + config.cacheTtl,
  })
}

/**
 * Get data from cache if it exists and hasn't expired.
 * Returns null if not found or expired.
 */
export function getCache(key: string): ScreenshotMetadata | null {
  const entry = cache.get(key)

  if (!entry) {
    return null
  }

  // Check if expired
  if (Date.now() > entry.expiresAt) {
    // Clean up expired entry
    cache.delete(key)
    return null
  }

  return entry.data
}

/**
 * Check if a key exists in cache and is not expired.
 */
export function hasCache(key: string): boolean {
  return getCache(key) !== null
}

/**
 * Delete a specific cache entry.
 */
export function deleteCache(key: string): boolean {
  return cache.delete(key)
}

/**
 * Clear all cached entries.
 * Useful for testing or manual cache invalidation.
 */
export function clearCache(): void {
  cache.clear()
}

/**
 * Get cache statistics.
 * Useful for monitoring/debugging.
 */
export function getCacheStats(): {
  size: number
  keys: string[]
} {
  // Clean up expired entries first
  const now = Date.now()
  for (const [key, entry] of cache.entries()) {
    if (now > entry.expiresAt) {
      cache.delete(key)
    }
  }

  return {
    size: cache.size,
    keys: Array.from(cache.keys()),
  }
}

/**
 * Periodic cleanup of expired entries.
 * Prevents memory leaks from accumulating expired entries.
 *
 * In production, you'd run this on an interval.
 * For now, it's called manually or via getCacheStats.
 */
export function cleanupExpiredCache(): number {
  const now = Date.now()
  let cleaned = 0

  for (const [key, entry] of cache.entries()) {
    if (now > entry.expiresAt) {
      cache.delete(key)
      cleaned++
    }
  }

  return cleaned
}

// Run cleanup every 5 minutes
setInterval(cleanupExpiredCache, 5 * 60 * 1000)
