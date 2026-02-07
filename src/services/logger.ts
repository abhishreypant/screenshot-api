// =============================================================================
// LOGGER SERVICE - Persistent logging with SQLite
//
// Tracks all requests with:
// - Request/response details
// - Timing information
// - Error traces
// - Screenshot metadata
// =============================================================================

import Database from 'better-sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Database path
const DB_PATH = path.join(__dirname, '..', '..', 'logs.db')

// Log levels
export type LogLevel = 'info' | 'warn' | 'error' | 'debug'

// Log entry structure
export interface LogEntry {
  id?: number
  timestamp: string
  level: LogLevel
  requestId: string
  method: string
  path: string
  statusCode: number
  duration: number // in ms
  ip: string
  userAgent: string

  // Request details
  requestBody?: string
  queryParams?: string

  // Response details
  responseBody?: string
  responseSize?: number

  // Screenshot specific
  screenshotUrl?: string
  targetUrl?: string

  // Error tracking
  error?: string
  errorStack?: string
  errorCode?: string

  // Cache info
  cacheHit?: boolean

  // Additional context
  metadata?: string
}

// Stats structure
export interface LogStats {
  totalRequests: number
  successfulRequests: number
  failedRequests: number
  avgResponseTime: number
  cacheHitRate: number
  requestsPerHour: { hour: string; count: number }[]
  topErrors: { code: string; count: number }[]
  statusCodeDistribution: { status: number; count: number }[]
}

// Initialize database
let db: Database.Database | null = null

function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH)
    db.pragma('journal_mode = WAL') // Better performance
    initializeSchema()
  }
  return db
}

function initializeSchema() {
  const database = getDb()

  database.exec(`
    CREATE TABLE IF NOT EXISTS logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      level TEXT NOT NULL,
      request_id TEXT NOT NULL,
      method TEXT NOT NULL,
      path TEXT NOT NULL,
      status_code INTEGER,
      duration INTEGER,
      ip TEXT,
      user_agent TEXT,
      request_body TEXT,
      query_params TEXT,
      response_body TEXT,
      response_size INTEGER,
      screenshot_url TEXT,
      target_url TEXT,
      error TEXT,
      error_stack TEXT,
      error_code TEXT,
      cache_hit INTEGER,
      metadata TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON logs(timestamp);
    CREATE INDEX IF NOT EXISTS idx_logs_level ON logs(level);
    CREATE INDEX IF NOT EXISTS idx_logs_request_id ON logs(request_id);
    CREATE INDEX IF NOT EXISTS idx_logs_status_code ON logs(status_code);
    CREATE INDEX IF NOT EXISTS idx_logs_path ON logs(path);
    CREATE INDEX IF NOT EXISTS idx_logs_error_code ON logs(error_code);
  `)

  console.log('[Logger] Database initialized')
}

/**
 * Generate a unique request ID
 */
export function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
}

/**
 * Log an entry to the database
 */
export function log(entry: LogEntry): void {
  try {
    const database = getDb()

    const stmt = database.prepare(`
      INSERT INTO logs (
        timestamp, level, request_id, method, path, status_code, duration,
        ip, user_agent, request_body, query_params, response_body, response_size,
        screenshot_url, target_url, error, error_stack, error_code, cache_hit, metadata
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
    `)

    // Ensure all values are proper SQLite-compatible types (string, number, null, Buffer)
    const sanitize = (val: any): string | number | null => {
      if (val === undefined || val === null) return null
      if (typeof val === 'string') return val
      if (typeof val === 'number') return val
      if (typeof val === 'boolean') return val ? 1 : 0
      return String(val)
    }

    stmt.run(
      sanitize(entry.timestamp),
      sanitize(entry.level),
      sanitize(entry.requestId),
      sanitize(entry.method),
      sanitize(entry.path),
      sanitize(entry.statusCode),
      sanitize(entry.duration),
      sanitize(entry.ip),
      sanitize(entry.userAgent),
      sanitize(entry.requestBody),
      sanitize(entry.queryParams),
      sanitize(entry.responseBody),
      sanitize(entry.responseSize),
      sanitize(entry.screenshotUrl),
      sanitize(entry.targetUrl),
      sanitize(entry.error),
      sanitize(entry.errorStack),
      sanitize(entry.errorCode),
      entry.cacheHit ? 1 : 0,
      sanitize(entry.metadata)
    )
  } catch (error) {
    console.error('[Logger] Failed to write log:', error)
  }
}

/**
 * Query logs with filters
 */
export function queryLogs(options: {
  level?: LogLevel
  path?: string
  statusCode?: number
  errorCode?: string
  startTime?: string
  endTime?: string
  search?: string
  limit?: number
  offset?: number
}): { logs: LogEntry[]; total: number } {
  const database = getDb()

  let whereClause = '1=1'
  const params: any[] = []

  if (options.level) {
    whereClause += ' AND level = ?'
    params.push(options.level)
  }

  if (options.path) {
    whereClause += ' AND path LIKE ?'
    params.push(`%${options.path}%`)
  }

  if (options.statusCode) {
    whereClause += ' AND status_code = ?'
    params.push(options.statusCode)
  }

  if (options.errorCode) {
    whereClause += ' AND error_code = ?'
    params.push(options.errorCode)
  }

  if (options.startTime) {
    whereClause += ' AND timestamp >= ?'
    params.push(options.startTime)
  }

  if (options.endTime) {
    whereClause += ' AND timestamp <= ?'
    params.push(options.endTime)
  }

  if (options.search) {
    whereClause += ' AND (error LIKE ? OR target_url LIKE ? OR request_id LIKE ?)'
    const searchTerm = `%${options.search}%`
    params.push(searchTerm, searchTerm, searchTerm)
  }

  // Get total count
  const countStmt = database.prepare(`SELECT COUNT(*) as count FROM logs WHERE ${whereClause}`)
  const { count: total } = countStmt.get(...params) as { count: number }

  // Get logs
  const limit = options.limit || 100
  const offset = options.offset || 0

  const stmt = database.prepare(`
    SELECT * FROM logs
    WHERE ${whereClause}
    ORDER BY timestamp DESC
    LIMIT ? OFFSET ?
  `)

  const rows = stmt.all(...params, limit, offset) as any[]

  const logs: LogEntry[] = rows.map(row => ({
    id: row.id,
    timestamp: row.timestamp,
    level: row.level,
    requestId: row.request_id,
    method: row.method,
    path: row.path,
    statusCode: row.status_code,
    duration: row.duration,
    ip: row.ip,
    userAgent: row.user_agent,
    requestBody: row.request_body,
    queryParams: row.query_params,
    responseBody: row.response_body,
    responseSize: row.response_size,
    screenshotUrl: row.screenshot_url,
    targetUrl: row.target_url,
    error: row.error,
    errorStack: row.error_stack,
    errorCode: row.error_code,
    cacheHit: row.cache_hit === 1,
    metadata: row.metadata,
  }))

  return { logs, total }
}

/**
 * Get a single log by ID
 */
export function getLogById(id: number): LogEntry | null {
  const database = getDb()
  const stmt = database.prepare('SELECT * FROM logs WHERE id = ?')
  const row = stmt.get(id) as any

  if (!row) return null

  return {
    id: row.id,
    timestamp: row.timestamp,
    level: row.level,
    requestId: row.request_id,
    method: row.method,
    path: row.path,
    statusCode: row.status_code,
    duration: row.duration,
    ip: row.ip,
    userAgent: row.user_agent,
    requestBody: row.request_body,
    queryParams: row.query_params,
    responseBody: row.response_body,
    responseSize: row.response_size,
    screenshotUrl: row.screenshot_url,
    targetUrl: row.target_url,
    error: row.error,
    errorStack: row.error_stack,
    errorCode: row.error_code,
    cacheHit: row.cache_hit === 1,
    metadata: row.metadata,
  }
}

/**
 * Get aggregated stats
 */
export function getStats(hours: number = 24): LogStats {
  const database = getDb()
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString()

  // Total requests
  const totalStmt = database.prepare('SELECT COUNT(*) as count FROM logs WHERE timestamp >= ?')
  const { count: totalRequests } = totalStmt.get(since) as { count: number }

  // Successful requests (2xx)
  const successStmt = database.prepare('SELECT COUNT(*) as count FROM logs WHERE timestamp >= ? AND status_code >= 200 AND status_code < 300')
  const { count: successfulRequests } = successStmt.get(since) as { count: number }

  // Failed requests (4xx, 5xx)
  const failedStmt = database.prepare('SELECT COUNT(*) as count FROM logs WHERE timestamp >= ? AND status_code >= 400')
  const { count: failedRequests } = failedStmt.get(since) as { count: number }

  // Average response time
  const avgStmt = database.prepare('SELECT AVG(duration) as avg FROM logs WHERE timestamp >= ? AND duration IS NOT NULL')
  const { avg } = avgStmt.get(since) as { avg: number | null }
  const avgResponseTime = avg || 0

  // Cache hit rate
  const cacheStmt = database.prepare(`
    SELECT
      SUM(CASE WHEN cache_hit = 1 THEN 1 ELSE 0 END) as hits,
      COUNT(*) as total
    FROM logs
    WHERE timestamp >= ? AND path LIKE '%screenshot%'
  `)
  const cacheResult = cacheStmt.get(since) as { hits: number; total: number }
  const cacheHitRate = cacheResult.total > 0 ? (cacheResult.hits / cacheResult.total) * 100 : 0

  // Requests per hour
  const hourlyStmt = database.prepare(`
    SELECT
      strftime('%Y-%m-%d %H:00', timestamp) as hour,
      COUNT(*) as count
    FROM logs
    WHERE timestamp >= ?
    GROUP BY hour
    ORDER BY hour
  `)
  const requestsPerHour = hourlyStmt.all(since) as { hour: string; count: number }[]

  // Top errors
  const errorsStmt = database.prepare(`
    SELECT error_code as code, COUNT(*) as count
    FROM logs
    WHERE timestamp >= ? AND error_code IS NOT NULL
    GROUP BY error_code
    ORDER BY count DESC
    LIMIT 10
  `)
  const topErrors = errorsStmt.all(since) as { code: string; count: number }[]

  // Status code distribution
  const statusStmt = database.prepare(`
    SELECT status_code as status, COUNT(*) as count
    FROM logs
    WHERE timestamp >= ? AND status_code IS NOT NULL
    GROUP BY status_code
    ORDER BY status_code
  `)
  const statusCodeDistribution = statusStmt.all(since) as { status: number; count: number }[]

  return {
    totalRequests,
    successfulRequests,
    failedRequests,
    avgResponseTime: Math.round(avgResponseTime),
    cacheHitRate: Math.round(cacheHitRate * 100) / 100,
    requestsPerHour,
    topErrors,
    statusCodeDistribution,
  }
}

/**
 * Clear old logs
 */
export function clearOldLogs(daysToKeep: number = 30): number {
  const database = getDb()
  const cutoff = new Date(Date.now() - daysToKeep * 24 * 60 * 60 * 1000).toISOString()

  const stmt = database.prepare('DELETE FROM logs WHERE timestamp < ?')
  const result = stmt.run(cutoff)

  return result.changes
}

/**
 * Close database connection
 */
export function closeLogger(): void {
  if (db) {
    db.close()
    db = null
    console.log('[Logger] Database closed')
  }
}
