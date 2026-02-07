// =============================================================================
// VALIDATORS - Input validation using Zod.
//
// Why Zod?
// 1. Runtime validation (not just compile-time like TypeScript)
// 2. Automatic type inference (write schema once, get types free)
// 3. Great error messages out of the box
// 4. Composable - build complex schemas from simple ones
// =============================================================================

import { z } from 'zod'

/**
 * URL validation is tricky. We need to:
 * 1. Check it's a valid URL format
 * 2. Only allow http/https (no file://, javascript://, etc.)
 * 3. Block internal/private IPs to prevent SSRF attacks
 */
const urlSchema = z
  .string()
  .url('Invalid URL format')
  .refine(
    (url) => {
      try {
        const parsed = new URL(url)
        return ['http:', 'https:'].includes(parsed.protocol)
      } catch {
        return false
      }
    },
    { message: 'URL must use http or https protocol' }
  )
  .refine(
    (url) => {
      try {
        const parsed = new URL(url)
        const hostname = parsed.hostname.toLowerCase()

        // Block localhost and common internal hostnames
        const blockedHostnames = [
          'localhost',
          '127.0.0.1',
          '0.0.0.0',
          '::1',
          'metadata.google.internal', // GCP metadata
          '169.254.169.254', // AWS/cloud metadata
        ]

        if (blockedHostnames.includes(hostname)) {
          return false
        }

        // Block private IP ranges (basic check)
        // 10.x.x.x, 172.16-31.x.x, 192.168.x.x
        const ipPattern = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/
        const match = hostname.match(ipPattern)
        if (match) {
          const [, a, b] = match.map(Number)
          if (a === 10) return false
          if (a === 172 && b >= 16 && b <= 31) return false
          if (a === 192 && b === 168) return false
        }

        return true
      } catch {
        return false
      }
    },
    { message: 'Internal/private URLs are not allowed' }
  )

/**
 * Main screenshot request schema.
 * Notice how we set sensible defaults - the simplest request just needs a URL.
 */
export const screenshotRequestSchema = z.object({
  url: urlSchema,
  width: z.number().int().min(320).max(3840).optional(),
  height: z.number().int().min(240).max(2160).optional(),
  fullPage: z.boolean().optional().default(false),
  darkMode: z.boolean().optional().default(false),
  blockAds: z.boolean().optional().default(true), // Default ON - most users want this
  device: z.enum(['desktop', 'tablet', 'mobile']).optional().default('desktop'),
  waitFor: z.enum(['load', 'domcontentloaded', 'networkidle']).optional().default('networkidle'),
  timeout: z.number().int().min(5000).max(60000).optional().default(30000),
})

/**
 * Infer the TypeScript type from the schema.
 * This is the magic of Zod - one source of truth.
 */
export type ScreenshotRequest = z.infer<typeof screenshotRequestSchema>

/**
 * Parse and validate a request body.
 * Returns either validated data or a formatted error.
 */
export function validateScreenshotRequest(body: unknown):
  | { success: true; data: ScreenshotRequest }
  | { success: false; error: string } {
  const result = screenshotRequestSchema.safeParse(body)

  if (result.success) {
    return { success: true, data: result.data }
  }

  // Zod 4 uses .issues instead of .errors, and also has .format()
  // Use the flatten() method for a cleaner error format
  try {
    const flattened = result.error.flatten()
    const fieldErrors = Object.entries(flattened.fieldErrors)
      .map(([field, messages]) => `${field}: ${(messages as string[]).join(', ')}`)
    const formErrors = flattened.formErrors

    const allErrors = [...formErrors, ...fieldErrors].filter(Boolean)
    return { success: false, error: allErrors.join('; ') || 'Validation failed' }
  } catch {
    // Fallback if flatten doesn't work
    return { success: false, error: result.error.message || 'Validation failed' }
  }
}
