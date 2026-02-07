// =============================================================================
// REQUEST LOGGER MIDDLEWARE - Captures all request/response details
//
// Attaches to every request and logs:
// - Timing
// - Request body
// - Response status
// - Errors with stack traces
// =============================================================================

import type { Context, Next } from 'hono'
import { log, generateRequestId, type LogLevel, type LogEntry } from '../services/logger.js'

// Extend Hono context to include our logging data
declare module 'hono' {
  interface ContextVariableMap {
    requestId: string
    startTime: number
    logData: Partial<LogEntry>
  }
}

/**
 * Get client IP from request
 */
function getClientIp(c: Context): string {
  const forwarded = c.req.header('x-forwarded-for')
  if (forwarded) {
    return forwarded.split(',')[0].trim()
  }
  const realIp = c.req.header('x-real-ip')
  if (realIp) {
    return realIp
  }
  return 'unknown'
}

/**
 * Safely stringify an object, handling circular refs
 */
function safeStringify(obj: any, maxLength: number = 10000): string | undefined {
  if (!obj) return undefined
  try {
    const str = JSON.stringify(obj)
    return str.length > maxLength ? str.substring(0, maxLength) + '...[truncated]' : str
  } catch {
    return '[unserializable]'
  }
}

/**
 * Request logger middleware
 * Wraps every request and captures detailed logging info
 */
export async function requestLogger(c: Context, next: Next): Promise<Response | void> {
  const requestId = generateRequestId()
  const startTime = Date.now()

  // Store in context for access in route handlers
  c.set('requestId', requestId)
  c.set('startTime', startTime)
  c.set('logData', {})

  // Add request ID to response headers
  c.header('X-Request-ID', requestId)

  // Capture request body for POST requests
  let requestBody: string | undefined
  if (c.req.method === 'POST') {
    try {
      const clonedReq = c.req.raw.clone()
      const body = await clonedReq.json()
      requestBody = safeStringify(body)
    } catch {
      // Not JSON or couldn't parse
    }
  }

  // Capture query params
  const queryParams = safeStringify(Object.fromEntries(new URL(c.req.url).searchParams))

  let error: Error | null = null
  let finalStatusCode = 200

  try {
    await next()
  } catch (err) {
    error = err instanceof Error ? err : new Error(String(err))
    finalStatusCode = 500
    throw err // Re-throw to let error handler deal with it
  } finally {
    const duration = Date.now() - startTime
    const logData = c.get('logData') || {}

    // Get status from the response (Hono sets c.res after middleware)
    try {
      if (c.res) {
        finalStatusCode = c.res.status
      }
    } catch {
      // Ignore if can't get status
    }

    // Determine log level based on status
    let level: LogLevel = 'info'
    if (finalStatusCode >= 500) level = 'error'
    else if (finalStatusCode >= 400) level = 'warn'

    // Build log entry - ensure all values are proper types
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      requestId,
      method: c.req.method,
      path: new URL(c.req.url).pathname,
      statusCode: Number(finalStatusCode) || 200,
      duration: Number(duration) || 0,
      ip: getClientIp(c),
      userAgent: c.req.header('user-agent') || 'unknown',
      requestBody,
      queryParams,
      // Spread logData but ensure proper types
      targetUrl: typeof logData.targetUrl === 'string' ? logData.targetUrl : undefined,
      screenshotUrl: typeof logData.screenshotUrl === 'string' ? logData.screenshotUrl : undefined,
      cacheHit: typeof logData.cacheHit === 'boolean' ? logData.cacheHit : undefined,
      error: typeof logData.error === 'string' ? logData.error : (error?.message || undefined),
      errorStack: typeof logData.errorStack === 'string' ? logData.errorStack : (error?.stack || undefined),
      errorCode: typeof logData.errorCode === 'string' ? logData.errorCode : undefined,
    }

    // Log to database
    log(entry)

    // Also log to console for development
    const statusEmoji = finalStatusCode >= 500 ? '🔴' : finalStatusCode >= 400 ? '🟡' : '🟢'
    console.log(
      `${statusEmoji} [${requestId}] ${c.req.method} ${entry.path} ${finalStatusCode} ${duration}ms`
    )
  }
}

/**
 * Helper to add extra log data from route handlers
 */
export function addLogData(c: Context, data: Partial<LogEntry>): void {
  const existing = c.get('logData') || {}
  c.set('logData', { ...existing, ...data })
}
