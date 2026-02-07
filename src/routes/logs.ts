// =============================================================================
// LOGS API ROUTES - Endpoints for querying and managing logs
// =============================================================================

import { Hono } from 'hono'
import { queryLogs, getLogById, getStats, clearOldLogs } from '../services/logger.js'
import type { LogLevel } from '../services/logger.js'

const logsRouter = new Hono()

/**
 * GET /logs
 * Query logs with filters
 */
logsRouter.get('/', (c) => {
  const level = c.req.query('level') as LogLevel | undefined
  const path = c.req.query('path')
  const statusCode = c.req.query('status') ? parseInt(c.req.query('status')!) : undefined
  const errorCode = c.req.query('errorCode')
  const startTime = c.req.query('startTime')
  const endTime = c.req.query('endTime')
  const search = c.req.query('search')
  const limit = c.req.query('limit') ? parseInt(c.req.query('limit')!) : 100
  const offset = c.req.query('offset') ? parseInt(c.req.query('offset')!) : 0

  const result = queryLogs({
    level,
    path,
    statusCode,
    errorCode,
    startTime,
    endTime,
    search,
    limit,
    offset,
  })

  return c.json({
    success: true,
    data: result.logs,
    pagination: {
      total: result.total,
      limit,
      offset,
      hasMore: offset + result.logs.length < result.total,
    },
  })
})

/**
 * GET /logs/stats
 * Get aggregated statistics
 */
logsRouter.get('/stats', (c) => {
  const hours = c.req.query('hours') ? parseInt(c.req.query('hours')!) : 24

  const stats = getStats(hours)

  return c.json({
    success: true,
    data: stats,
  })
})

/**
 * GET /logs/:id
 * Get a single log entry by ID
 */
logsRouter.get('/:id', (c) => {
  const id = parseInt(c.req.param('id'))

  if (isNaN(id)) {
    return c.json({ success: false, error: 'Invalid log ID' }, 400)
  }

  const log = getLogById(id)

  if (!log) {
    return c.json({ success: false, error: 'Log not found' }, 404)
  }

  return c.json({
    success: true,
    data: log,
  })
})

/**
 * DELETE /logs/cleanup
 * Clean up old logs
 */
logsRouter.delete('/cleanup', (c) => {
  const days = c.req.query('days') ? parseInt(c.req.query('days')!) : 30

  const deleted = clearOldLogs(days)

  return c.json({
    success: true,
    data: {
      deleted,
      message: `Deleted ${deleted} logs older than ${days} days`,
    },
  })
})

export { logsRouter }
