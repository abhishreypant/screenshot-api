// =============================================================================
// STORAGE SERVICE - File system storage for screenshots.
//
// Mimics CDN behavior:
// - Files served with cache headers
// - Direct URL access to images
// - Could be swapped to S3/R2 with same interface
//
// This service only knows about files, not about HTTP or screenshots.
// That's the "separation of concerns" principle in action.
// =============================================================================

import fs from 'fs/promises'
import path from 'path'
import { config } from '../config.js'

/**
 * Ensure the storage directory exists.
 * Called on startup - fail fast if we can't write.
 */
export async function ensureStorageDir(): Promise<void> {
  try {
    await fs.mkdir(config.storagePath, { recursive: true })
  } catch (error) {
    throw new Error(`Failed to create storage directory: ${error}`)
  }
}

/**
 * Save a screenshot buffer to storage.
 *
 * @param id - Unique identifier for the screenshot
 * @param buffer - The image data
 * @returns The file path (relative to storage root)
 */
export async function saveScreenshot(id: string, buffer: Buffer): Promise<string> {
  const filename = `${id}.png`
  const filepath = path.join(config.storagePath, filename)

  await fs.writeFile(filepath, buffer)

  return filename
}

/**
 * Get a screenshot buffer from storage.
 *
 * @param id - The screenshot ID (without extension)
 * @returns The image buffer, or null if not found
 */
export async function getScreenshot(id: string): Promise<Buffer | null> {
  const filename = `${id}.png`
  const filepath = path.join(config.storagePath, filename)

  try {
    return await fs.readFile(filepath)
  } catch (error) {
    // File doesn't exist
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }
    throw error
  }
}

/**
 * Check if a screenshot exists.
 */
export async function screenshotExists(id: string): Promise<boolean> {
  const filename = `${id}.png`
  const filepath = path.join(config.storagePath, filename)

  try {
    await fs.access(filepath)
    return true
  } catch {
    return false
  }
}

/**
 * Delete a screenshot from storage.
 *
 * @param id - The screenshot ID
 * @returns true if deleted, false if didn't exist
 */
export async function deleteScreenshot(id: string): Promise<boolean> {
  const filename = `${id}.png`
  const filepath = path.join(config.storagePath, filename)

  try {
    await fs.unlink(filepath)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false
    }
    throw error
  }
}

/**
 * Get file size of a screenshot.
 *
 * @param id - The screenshot ID
 * @returns Size in bytes, or null if not found
 */
export async function getScreenshotSize(id: string): Promise<number | null> {
  const filename = `${id}.png`
  const filepath = path.join(config.storagePath, filename)

  try {
    const stats = await fs.stat(filepath)
    return stats.size
  } catch {
    return null
  }
}

/**
 * Generate the public URL for a screenshot.
 * This is where CDN-like behavior comes in.
 */
export function getScreenshotUrl(id: string): string {
  return `${config.baseUrl}/screenshots/${id}.png`
}

/**
 * Clean up old screenshots.
 * In production, you'd run this as a cron job.
 *
 * @param maxAgeMs - Delete files older than this (default: 24 hours)
 * @returns Number of files deleted
 */
export async function cleanupOldScreenshots(maxAgeMs = 24 * 60 * 60 * 1000): Promise<number> {
  const files = await fs.readdir(config.storagePath)
  const now = Date.now()
  let deleted = 0

  for (const file of files) {
    if (!file.endsWith('.png')) continue

    const filepath = path.join(config.storagePath, file)
    try {
      const stats = await fs.stat(filepath)
      if (now - stats.mtimeMs > maxAgeMs) {
        await fs.unlink(filepath)
        deleted++
      }
    } catch {
      // Ignore errors for individual files
    }
  }

  return deleted
}
