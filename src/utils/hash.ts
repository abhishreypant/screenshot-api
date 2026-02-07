// =============================================================================
// HASH - Generate deterministic cache keys.
//
// Why hash?
// Same URL + same options = same screenshot = should be cached.
// We create a unique key from all inputs that affect the output.
// =============================================================================

import crypto from 'crypto'
import type { ScreenshotRequest } from './validators.js'

/**
 * Generate a cache key from screenshot request.
 *
 * We hash all parameters that affect the output image.
 * If any of these change, we need a fresh screenshot.
 *
 * Using SHA-256 truncated to 16 chars:
 * - Fast enough for our needs
 * - Collision probability is negligible for our scale
 * - Short enough to be readable in URLs
 */
export function generateCacheKey(request: ScreenshotRequest): string {
  // Create a deterministic string from the request
  // Sort keys to ensure consistent ordering
  const normalized = {
    url: request.url,
    width: request.width,
    height: request.height,
    fullPage: request.fullPage,
    darkMode: request.darkMode,
    blockAds: request.blockAds,
    device: request.device,
    waitFor: request.waitFor,
    // Note: timeout is NOT included - it doesn't affect the output
  }

  const str = JSON.stringify(normalized)
  const hash = crypto.createHash('sha256').update(str).digest('hex')

  // Return first 16 characters - enough for uniqueness at our scale
  return hash.substring(0, 16)
}

/**
 * Generate a unique ID for a screenshot file.
 * This is different from cache key - it's for the filename.
 *
 * Format: {timestamp}-{random}
 * - Timestamp for rough chronological ordering
 * - Random suffix to prevent collisions
 */
export function generateScreenshotId(): string {
  const timestamp = Date.now().toString(36) // Base36 for compactness
  const random = crypto.randomBytes(4).toString('hex')
  return `${timestamp}-${random}`
}
