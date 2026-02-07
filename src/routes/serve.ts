// =============================================================================
// SERVE ROUTE - GET /screenshots/:id
//
// Serves screenshots with CDN-like behavior:
// - Proper cache headers
// - Content-Type headers
// - 404 for missing files
// =============================================================================

import { Hono } from 'hono'
import { getScreenshot } from '../services/storage.js'
import { throwNotFoundError } from '../middleware/errorHandler.js'
import { config } from '../config.js'

const serveRouter = new Hono()

/**
 * GET /screenshots/:filename
 *
 * Serves a screenshot image.
 * Filename format: {id}.png
 */
serveRouter.get('/:filename', async (c) => {
  const filename = c.req.param('filename')

  // Validate filename format (security: prevent path traversal)
  if (!filename || !filename.match(/^[a-z0-9-]+\.png$/i)) {
    throwNotFoundError('Invalid filename')
  }

  // Extract ID from filename
  const id = filename.replace('.png', '')

  // Get the screenshot from storage
  const buffer = await getScreenshot(id)

  if (!buffer) {
    throwNotFoundError('Screenshot not found')
  }

  // Cache headers
  const cacheSeconds = Math.floor(config.cacheTtl / 1000)

  // Return proper binary response with correct headers
  return new Response(buffer, {
    status: 200,
    headers: {
      'Content-Type': 'image/png',
      'Content-Length': String(buffer.length),
      'Cache-Control': `public, max-age=${cacheSeconds}, immutable`,
      'ETag': `"${id}"`,
    },
  })
})

export { serveRouter }
