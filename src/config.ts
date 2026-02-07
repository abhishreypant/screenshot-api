// =============================================================================
// CONFIG - Single source of truth for all configuration.
// Environment variables with sensible defaults.
// Change behavior here, not scattered throughout the codebase.
// =============================================================================

import path from 'path'
import { fileURLToPath } from 'url'

// ES modules don't have __dirname, so we derive it
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export const config = {
  // Server
  port: parseInt(process.env.PORT || '3000', 10),
  host: process.env.HOST || 'localhost',

  // Get the base URL for generating screenshot URLs
  get baseUrl() {
    return process.env.BASE_URL || `http://${this.host}:${this.port}`
  },

  // Storage
  storagePath: process.env.STORAGE_PATH || path.join(__dirname, '..', 'storage'),

  // Cache TTL in milliseconds (1 hour)
  cacheTtl: parseInt(process.env.CACHE_TTL || String(60 * 60 * 1000), 10),

  // Rate limiting
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW || String(60 * 60 * 1000), 10), // 1 hour
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX || '10', 10), // 10 requests per hour
  },

  // Screenshot defaults
  screenshot: {
    defaultWidth: 1920,
    defaultHeight: 1080,
    defaultTimeout: 30000, // 30 seconds
    maxTimeout: 60000, // 60 seconds max
  },

  // Device presets - common viewport sizes
  // These are based on real device data, not arbitrary numbers
  devices: {
    desktop: { width: 1920, height: 1080 },
    tablet: { width: 768, height: 1024 },
    mobile: { width: 375, height: 667 },
  },
} as const

// Type for device keys
export type DeviceType = keyof typeof config.devices
