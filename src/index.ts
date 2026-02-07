// =============================================================================
// MAIN ENTRY POINT - Where everything comes together.
//
// This file has three jobs:
// 1. Create the Hono app
// 2. Wire up middleware and routes
// 3. Start the server and handle lifecycle
//
// Notice how simple this is - all the complexity is hidden in modules.
// =============================================================================

import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { cors } from 'hono/cors'

import { config } from './config.js'
import { screenshotRouter, serveRouter } from './routes/index.js'
import { logsRouter } from './routes/logs.js'
import { rateLimiter, AppError } from './middleware/index.js'
import { requestLogger, addLogData } from './middleware/requestLogger.js'
import { ensureStorageDir } from './services/storage.js'
import { closeBrowser, isBrowserHealthy } from './services/browser.js'
import { getCacheStats } from './services/cache.js'
import { closeLogger } from './services/logger.js'
import type { ApiSuccessResponse, ApiErrorResponse, ErrorCode } from './types/index.js'

// Create the Hono app
const app = new Hono()

// =============================================================================
// GLOBAL ERROR HANDLER
// Hono uses onError for catching all errors - this is the proper pattern
// =============================================================================

/**
 * Error patterns to classify unknown errors
 */
const ERROR_PATTERNS: Array<{
  pattern: RegExp
  code: ErrorCode
  status: number
  message: string
}> = [
  { pattern: /timeout/i, code: 'TIMEOUT', status: 504, message: 'The page took too long to load' },
  { pattern: /net::ERR_NAME_NOT_RESOLVED/i, code: 'INVALID_URL', status: 400, message: 'Could not resolve the domain name' },
  { pattern: /net::ERR_CONNECTION_REFUSED/i, code: 'SCREENSHOT_FAILED', status: 502, message: 'Connection refused by the target server' },
  { pattern: /net::ERR_SSL/i, code: 'SCREENSHOT_FAILED', status: 502, message: 'SSL/TLS error when connecting to the target' },
  { pattern: /Navigation failed/i, code: 'SCREENSHOT_FAILED', status: 502, message: 'Failed to navigate to the page' },
]

app.onError((err, c) => {
  console.error('[Error]', err)

  // Handle our custom AppError
  if (err instanceof AppError) {
    // Add error info to logs
    addLogData(c, {
      error: err.message,
      errorCode: err.code,
      errorStack: err.stack,
    })

    const response: ApiErrorResponse = {
      success: false,
      error: {
        code: err.code,
        message: err.message,
      },
    }
    return c.json(response, err.statusCode as 400 | 500)
  }

  // Try to classify the error
  if (err instanceof Error) {
    for (const { pattern, code, status, message } of ERROR_PATTERNS) {
      if (pattern.test(err.message)) {
        // Add error info to logs
        addLogData(c, {
          error: err.message,
          errorCode: code,
          errorStack: err.stack,
        })

        const response: ApiErrorResponse = {
          success: false,
          error: { code, message },
        }
        return c.json(response, status as 400 | 500)
      }
    }

    // Unclassified error
    addLogData(c, {
      error: err.message,
      errorCode: 'INTERNAL_ERROR',
      errorStack: err.stack,
    })
  }

  // Default internal error
  const response: ApiErrorResponse = {
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    },
  }
  return c.json(response, 500)
})

// =============================================================================
// GLOBAL MIDDLEWARE
// Order matters! These run for every request, top to bottom.
// =============================================================================

// 1. CORS (allow cross-origin requests)
app.use(
  '*',
  cors({
    origin: '*', // In production, lock this down
    allowMethods: ['GET', 'POST', 'DELETE'],
    allowHeaders: ['Content-Type'],
    exposeHeaders: ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset', 'X-Cache', 'X-Request-ID'],
  })
)

// 2. Request logging (captures all requests to database)
app.use('*', requestLogger)

// =============================================================================
// ROUTES
// =============================================================================

// Health check - useful for load balancers and monitoring
app.get('/health', async (c) => {
  const browserHealthy = await isBrowserHealthy()
  const cacheStats = getCacheStats()

  const response: ApiSuccessResponse<{
    status: string
    browser: boolean
    cache: { size: number }
    uptime: number
  }> = {
    success: true,
    data: {
      status: browserHealthy ? 'healthy' : 'degraded',
      browser: browserHealthy,
      cache: { size: cacheStats.size },
      uptime: process.uptime(),
    },
  }

  const statusCode = browserHealthy ? 200 : 503
  return c.json(response, statusCode)
})

// Screenshot endpoint with rate limiting
// Only the screenshot route gets rate-limited, not the serve route
app.use('/screenshot', rateLimiter)
app.route('/screenshot', screenshotRouter)

// Serve screenshots (CDN-like endpoint)
app.route('/screenshots', serveRouter)

// Logs API (for the dashboard)
app.route('/api/logs', logsRouter)

// Serve static files from public directory
app.use('/*', serveStatic({ root: './public' }))

// =============================================================================
// SERVER LIFECYCLE
// =============================================================================

/**
 * Graceful shutdown handler.
 * Close connections cleanly when the process is terminated.
 */
async function shutdown(signal: string) {
  console.log(`\n[Server] Received ${signal}, shutting down gracefully...`)

  // Close the browser
  await closeBrowser()

  // Close logger database
  closeLogger()

  console.log('[Server] Cleanup complete, exiting')
  process.exit(0)
}

// Listen for termination signals
process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))

/**
 * Start the server.
 */
async function main() {
  try {
    // Ensure storage directory exists
    await ensureStorageDir()
    console.log(`[Server] Storage directory ready: ${config.storagePath}`)

    // Start the HTTP server
    serve(
      {
        fetch: app.fetch,
        port: config.port,
      },
      (info) => {
        console.log(`
╔════════════════════════════════════════════════════════════╗
║                    SCREENSHOT API                          ║
╠════════════════════════════════════════════════════════════╣
║  Server running at: http://${config.host}:${config.port.toString().padEnd(24)}║
║  Rate limit: ${config.rateLimit.maxRequests} requests per hour${' '.repeat(27)}║
║  Cache TTL: ${Math.floor(config.cacheTtl / 60000)} minutes${' '.repeat(36)}║
╚════════════════════════════════════════════════════════════╝
`)
        console.log('[Server] Ready to capture screenshots!')
      }
    )
  } catch (error) {
    console.error('[Server] Failed to start:', error)
    process.exit(1)
  }
}

// Run!
main()
