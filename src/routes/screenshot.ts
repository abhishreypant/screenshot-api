// =============================================================================
// SCREENSHOT ROUTE - POST /screenshot
//
// This is the "controller" or "handler" layer.
// It translates HTTP requests into application operations.
//
// Responsibilities:
// 1. Parse and validate request body
// 2. Check cache
// 3. Call services to do the work
// 4. Format the response
//
// NOT responsible for:
// - How screenshots are taken (browser service)
// - How files are stored (storage service)
// - How cache works (cache service)
// =============================================================================

import { Hono } from 'hono'
import { validateScreenshotRequest, ScreenshotRequest } from '../utils/validators.js'
import { generateCacheKey, generateScreenshotId } from '../utils/hash.js'
import { getCache, setCache } from '../services/cache.js'
import { captureScreenshot } from '../services/browser.js'
import { saveScreenshot, getScreenshotUrl, getScreenshotSize } from '../services/storage.js'
import { throwValidationError } from '../middleware/errorHandler.js'
import { addLogData } from '../middleware/requestLogger.js'
import { config } from '../config.js'
import type { ApiSuccessResponse, ScreenshotResponse, ScreenshotMetadata } from '../types/index.js'

const screenshotRouter = new Hono()

/**
 * POST /screenshot
 *
 * Request body:
 * {
 *   "url": "https://example.com",
 *   "width": 1920,          // optional
 *   "height": 1080,         // optional
 *   "fullPage": false,      // optional
 *   "darkMode": false,      // optional
 *   "blockAds": true,       // optional
 *   "device": "desktop",    // optional: desktop | tablet | mobile
 *   "waitFor": "networkidle" // optional: load | domcontentloaded | networkidle
 * }
 */
screenshotRouter.post('/', async (c) => {
  // 1. Parse request body
  const body = await c.req.json().catch(() => ({}))

  // 2. Validate input
  const validation = validateScreenshotRequest(body)
  if (!validation.success) {
    throwValidationError(validation.error)
  }

  const request: ScreenshotRequest = validation.data

  // Add target URL to log data
  addLogData(c, { targetUrl: request.url })

  // Check if client wants direct image response
  const returnImage = c.req.query('response') === 'image'

  // 3. Generate cache key from request
  const cacheKey = generateCacheKey(request)
  console.log(`[Screenshot] Request for ${request.url}, cache key: ${cacheKey}`)

  // 4. Check cache
  const cached = getCache(cacheKey)
  if (cached) {
    console.log(`[Screenshot] Cache hit for ${cacheKey}`)
    c.header('X-Cache', 'HIT')
    addLogData(c, { cacheHit: true, screenshotUrl: getScreenshotUrl(cached.id) })

    // Return image directly if requested
    if (returnImage) {
      const buffer = await import('../services/storage.js').then(m => m.getScreenshot(cached.id))
      if (buffer) {
        return new Response(buffer, {
          status: 200,
          headers: {
            'Content-Type': 'image/png',
            'Content-Length': String(buffer.length),
            'X-Cache': 'HIT',
          },
        })
      }
    }

    const response: ApiSuccessResponse<ScreenshotResponse> = {
      success: true,
      data: {
        url: getScreenshotUrl(cached.id),
        cachedAt: cached.capturedAt.toISOString(),
        expiresAt: cached.expiresAt.toISOString(),
        metadata: {
          width: cached.width,
          height: cached.height,
          fullPage: cached.fullPage,
          fileSize: cached.fileSize,
        },
      },
    }

    return c.json(response)
  }

  console.log(`[Screenshot] Cache miss for ${cacheKey}, capturing...`)
  c.header('X-Cache', 'MISS')
  addLogData(c, { cacheHit: false })

  // 5. Capture screenshot
  const buffer = await captureScreenshot(request)

  // 6. Generate ID and save to storage
  const screenshotId = generateScreenshotId()
  await saveScreenshot(screenshotId, buffer)

  // 7. Get the resolved dimensions (might be from device preset)
  const device = config.devices[request.device]
  const width = request.width || device.width
  const height = request.height || device.height

  // 8. Create metadata
  const now = new Date()
  const metadata: ScreenshotMetadata = {
    id: screenshotId,
    url: request.url,
    width,
    height,
    fullPage: request.fullPage,
    fileSize: buffer.length,
    capturedAt: now,
    expiresAt: new Date(now.getTime() + config.cacheTtl),
  }

  // 9. Store in cache
  setCache(cacheKey, metadata)

  // Log the screenshot URL
  addLogData(c, { screenshotUrl: getScreenshotUrl(screenshotId) })

  // 10. Return image directly if requested
  if (returnImage) {
    return new Response(buffer, {
      status: 201,
      headers: {
        'Content-Type': 'image/png',
        'Content-Length': String(buffer.length),
        'X-Cache': 'MISS',
      },
    })
  }

  // 11. Return JSON response
  const response: ApiSuccessResponse<ScreenshotResponse> = {
    success: true,
    data: {
      url: getScreenshotUrl(screenshotId),
      cachedAt: metadata.capturedAt.toISOString(),
      expiresAt: metadata.expiresAt.toISOString(),
      metadata: {
        width: metadata.width,
        height: metadata.height,
        fullPage: metadata.fullPage,
        fileSize: metadata.fileSize,
      },
    },
  }

  return c.json(response, 201)
})

export { screenshotRouter }
