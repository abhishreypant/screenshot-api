// =============================================================================
// ERROR HANDLER MIDDLEWARE - Consistent error formatting.
//
// Goals:
// 1. Never leak stack traces to clients (security)
// 2. Always return consistent JSON shape (DX)
// 3. Log full errors internally (debugging)
// 4. Map known errors to appropriate HTTP status codes
// =============================================================================

import type { Context, Next } from 'hono'
import type { ApiErrorResponse, ErrorCode } from '../types/index.js'

/**
 * Custom error class for application errors.
 * Allows throwing errors with specific codes and status.
 */
export class AppError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public statusCode: number = 500
  ) {
    super(message)
    this.name = 'AppError'
  }
}

/**
 * Map of known error patterns to error codes.
 * Used to classify errors from Playwright and other libraries.
 */
const ERROR_PATTERNS: Array<{
  pattern: RegExp | string
  code: ErrorCode
  status: number
  message?: string
}> = [
  {
    pattern: /timeout/i,
    code: 'TIMEOUT',
    status: 504,
    message: 'The page took too long to load',
  },
  {
    pattern: /net::ERR_NAME_NOT_RESOLVED/i,
    code: 'INVALID_URL',
    status: 400,
    message: 'Could not resolve the domain name',
  },
  {
    pattern: /net::ERR_CONNECTION_REFUSED/i,
    code: 'SCREENSHOT_FAILED',
    status: 502,
    message: 'Connection refused by the target server',
  },
  {
    pattern: /net::ERR_SSL/i,
    code: 'SCREENSHOT_FAILED',
    status: 502,
    message: 'SSL/TLS error when connecting to the target',
  },
  {
    pattern: /net::ERR_CERT/i,
    code: 'SCREENSHOT_FAILED',
    status: 502,
    message: 'Certificate error when connecting to the target',
  },
  {
    pattern: /Navigation failed/i,
    code: 'SCREENSHOT_FAILED',
    status: 502,
    message: 'Failed to navigate to the page',
  },
  {
    pattern: /Protocol error/i,
    code: 'INTERNAL_ERROR',
    status: 500,
    message: 'Browser communication error',
  },
  {
    pattern: /blocked/i,
    code: 'BLOCKED_URL',
    status: 403,
    message: 'This URL is blocked for security reasons',
  },
]

/**
 * Classify an error into a known category.
 */
function classifyError(error: Error): { code: ErrorCode; status: number; message: string } {
  const errorMessage = error.message || ''

  for (const { pattern, code, status, message } of ERROR_PATTERNS) {
    const matches = typeof pattern === 'string' ? errorMessage.includes(pattern) : pattern.test(errorMessage)

    if (matches) {
      return {
        code,
        status,
        message: message || errorMessage,
      }
    }
  }

  // Default to internal error
  return {
    code: 'INTERNAL_ERROR',
    status: 500,
    message: 'An unexpected error occurred',
  }
}

/**
 * Format an error into a consistent API response.
 */
function formatErrorResponse(code: ErrorCode, message: string, retryAfter?: number): ApiErrorResponse {
  return {
    success: false,
    error: {
      code,
      message,
      ...(retryAfter !== undefined && { retryAfter }),
    },
  }
}

/**
 * Global error handler middleware.
 *
 * Catches all errors thrown in the request pipeline,
 * classifies them, and returns a consistent response.
 */
export async function errorHandler(c: Context, next: Next): Promise<Response | void> {
  try {
    await next()
  } catch (error) {
    // Log the full error internally
    console.error('[Error]', error)

    // Handle our custom AppError
    if (error instanceof AppError) {
      const response = formatErrorResponse(error.code, error.message)
      return c.json(response, error.statusCode as 400 | 500)
    }

    // Handle standard errors
    if (error instanceof Error) {
      const { code, status, message } = classifyError(error)
      const response = formatErrorResponse(code, message)
      return c.json(response, status as 400 | 500)
    }

    // Unknown error type
    const response = formatErrorResponse('INTERNAL_ERROR', 'An unexpected error occurred')
    return c.json(response, 500)
  }
}

/**
 * Helper to throw validation errors.
 */
export function throwValidationError(message: string): never {
  throw new AppError('VALIDATION_ERROR', message, 400)
}

/**
 * Helper to throw not found errors.
 */
export function throwNotFoundError(message: string = 'Resource not found'): never {
  throw new AppError('NOT_FOUND', message, 404)
}

/**
 * Helper to throw screenshot errors.
 */
export function throwScreenshotError(message: string): never {
  throw new AppError('SCREENSHOT_FAILED', message, 502)
}
