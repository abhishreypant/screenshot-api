// =============================================================================
// TYPES - The innermost layer. Pure data shapes. No logic. No dependencies.
// These define the "language" our application speaks.
// =============================================================================

/**
 * What the user can request when taking a screenshot.
 * Each field represents a decision point in the capture process.
 */
export interface ScreenshotOptions {
  url: string
  width: number
  height: number
  fullPage: boolean
  darkMode: boolean
  blockAds: boolean
  device: 'desktop' | 'tablet' | 'mobile'
  waitFor: 'load' | 'domcontentloaded' | 'networkidle'
  timeout: number
}

/**
 * Metadata about a captured screenshot.
 * Stored alongside the image for cache validation and API responses.
 */
export interface ScreenshotMetadata {
  id: string
  url: string
  width: number
  height: number
  fullPage: boolean
  fileSize: number
  capturedAt: Date
  expiresAt: Date
}

/**
 * Successful API response shape.
 * Consistent structure makes client integration predictable.
 */
export interface ApiSuccessResponse<T> {
  success: true
  data: T
}

/**
 * Error codes - finite set of known failure modes.
 * Using a union type means we can't accidentally invent new codes.
 */
export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'RATE_LIMIT_EXCEEDED'
  | 'SCREENSHOT_FAILED'
  | 'TIMEOUT'
  | 'INVALID_URL'
  | 'BLOCKED_URL'
  | 'NOT_FOUND'
  | 'INTERNAL_ERROR'

/**
 * Error API response shape.
 * retryAfter is optional - only relevant for rate limiting.
 */
export interface ApiErrorResponse {
  success: false
  error: {
    code: ErrorCode
    message: string
    retryAfter?: number
  }
}

/**
 * Union type for all API responses.
 * This is what every endpoint returns.
 */
export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse

/**
 * Cache entry wraps data with TTL metadata.
 * Generic so we can cache different types of data.
 */
export interface CacheEntry<T> {
  data: T
  createdAt: number
  expiresAt: number
}

/**
 * Rate limit state for a single client (identified by IP).
 */
export interface RateLimitEntry {
  count: number
  windowStart: number
}

/**
 * The response shape for the screenshot endpoint.
 */
export interface ScreenshotResponse {
  url: string
  cachedAt: string
  expiresAt: string
  metadata: {
    width: number
    height: number
    fullPage: boolean
    fileSize: number
  }
}
