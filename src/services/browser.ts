// =============================================================================
// BROWSER SERVICE - Playwright-based screenshot capture.
//
// This is the heart of the system. Key design decisions:
//
// 1. Singleton browser instance
//    - Browser startup is slow (~500ms-2s)
//    - Reusing one browser for all requests is faster
//    - Trade-off: Memory stays allocated, but that's fine for VPS
//
// 2. New context per screenshot
//    - Contexts are lightweight (~50ms to create)
//    - Provides isolation (cookies, cache cleared between requests)
//    - Prevents state leakage between screenshots
//
// 3. Request interception for ad blocking
//    - Intercept at network level before resources load
//    - Much faster than waiting for DOM and hiding elements
// =============================================================================

import { chromium, Browser, BrowserContext, Page } from 'playwright'
import { config } from '../config.js'
import { shouldBlockUrl } from '../utils/adblock.js'
import type { ScreenshotRequest } from '../utils/validators.js'

/**
 * Singleton browser instance.
 * Initialized lazily on first request.
 */
let browser: Browser | null = null
let browserLock: Promise<Browser> | null = null

/**
 * Get or create the browser instance.
 * Uses a lock to prevent race conditions when multiple requests come in.
 */
async function getBrowser(): Promise<Browser> {
  // If browser exists and is connected, return it
  if (browser && browser.isConnected()) {
    return browser
  }

  // If already launching, wait for that
  if (browserLock) {
    return browserLock
  }

  // Launch new browser with lock
  browserLock = (async () => {
    try {
      // Close old browser if it exists
      if (browser) {
        try {
          await browser.close()
        } catch {
          // Ignore close errors
        }
        browser = null
      }

      console.log('[Browser] Launching new browser instance...')
      browser = await chromium.launch({
        headless: true,
        args: [
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--no-first-run',
          '--mute-audio',
        ],
      })
      console.log('[Browser] Browser launched successfully')
      return browser
    } finally {
      browserLock = null
    }
  })()

  return browserLock
}

/**
 * Create a new browser context with the specified settings.
 * Context = isolated browser session (like an incognito window).
 */
async function createContext(options: ScreenshotRequest): Promise<BrowserContext> {
  const browserInstance = await getBrowser()

  // Get viewport dimensions
  const device = config.devices[options.device]
  const width = options.width || device.width
  const height = options.height || device.height

  const context = await browserInstance.newContext({
    viewport: { width, height },

    // Device emulation
    userAgent: getUserAgent(options.device),
    deviceScaleFactor: options.device === 'mobile' ? 2 : 1,
    isMobile: options.device === 'mobile',
    hasTouch: options.device === 'mobile' || options.device === 'tablet',

    // Dark mode
    colorScheme: options.darkMode ? 'dark' : 'light',

    // Performance optimizations
    javaScriptEnabled: true, // Need JS for dynamic content
    bypassCSP: true, // Some sites block screenshots via CSP
    ignoreHTTPSErrors: true, // Don't fail on cert issues
  })

  return context
}

/**
 * User agent strings for different devices.
 * Using real-world UA strings for better compatibility.
 */
function getUserAgent(device: 'desktop' | 'tablet' | 'mobile'): string {
  const agents = {
    desktop:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    tablet:
      'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    mobile:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  }
  return agents[device]
}

/**
 * Set up request interception for ad blocking.
 */
async function setupAdBlocking(page: Page): Promise<void> {
  await page.route('**/*', (route) => {
    const url = route.request().url()

    if (shouldBlockUrl(url)) {
      // Abort the request silently
      route.abort('blockedbyclient')
    } else {
      route.continue()
    }
  })
}

/**
 * Wait for the page to be "ready" based on the strategy.
 */
async function waitForPage(page: Page, waitFor: ScreenshotRequest['waitFor']): Promise<void> {
  switch (waitFor) {
    case 'load':
      await page.waitForLoadState('load')
      break
    case 'domcontentloaded':
      await page.waitForLoadState('domcontentloaded')
      break
    case 'networkidle':
      // Wait for network to be idle (no requests for 500ms)
      await page.waitForLoadState('networkidle')
      break
  }

  // Additional wait for any lazy-loaded content
  // This catches images that load after networkidle
  await page.waitForTimeout(500)
}

/**
 * Main capture function - the core of this service.
 * Includes retry logic for browser crashes.
 *
 * @param options - Screenshot options
 * @returns PNG buffer of the screenshot
 */
export async function captureScreenshot(options: ScreenshotRequest): Promise<Buffer> {
  const maxRetries = 2
  let lastError: Error | null = null

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await captureScreenshotOnce(options)
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      const msg = lastError.message

      // Retry on browser/context closed errors
      if (msg.includes('closed') || msg.includes('Target page') || msg.includes('Protocol error')) {
        console.log(`[Browser] Attempt ${attempt + 1} failed, ${attempt < maxRetries ? 'retrying...' : 'no more retries'}`)
        // Force browser restart
        if (browser) {
          try { await browser.close() } catch {}
          browser = null
        }
        continue
      }

      // Don't retry other errors
      throw lastError
    }
  }

  throw lastError || new Error('Screenshot capture failed')
}

/**
 * Single attempt at capturing a screenshot.
 */
async function captureScreenshotOnce(options: ScreenshotRequest): Promise<Buffer> {
  let context: BrowserContext | null = null
  let page: Page | null = null

  try {
    // Create isolated context
    context = await createContext(options)
    page = await context.newPage()

    // Set up ad blocking if enabled
    if (options.blockAds) {
      await setupAdBlocking(page)
    }

    // Navigate to the URL with timeout
    console.log(`[Browser] Navigating to ${options.url}`)

    try {
      await page.goto(options.url, {
        timeout: options.timeout,
        waitUntil: 'domcontentloaded', // Initial navigation
      })
    } catch (navError) {
      // Provide better error messages for navigation failures
      const msg = navError instanceof Error ? navError.message : String(navError)
      if (msg.includes('ERR_NAME_NOT_RESOLVED')) {
        throw new Error(`Could not resolve domain: ${new URL(options.url).hostname}`)
      }
      if (msg.includes('ERR_CONNECTION_REFUSED')) {
        throw new Error(`Connection refused by ${new URL(options.url).hostname}`)
      }
      if (msg.includes('ERR_CONNECTION_TIMED_OUT') || msg.includes('Timeout')) {
        throw new Error(`Timeout navigating to ${options.url}`)
      }
      throw navError
    }

    // Wait for page to be ready
    try {
      await waitForPage(page, options.waitFor)
    } catch (waitError) {
      // Don't fail on wait errors - page might still be usable
      console.warn(`[Browser] Wait warning: ${waitError}`)
    }

    console.log(`[Browser] Page loaded, taking screenshot`)

    // Take the screenshot
    const buffer = await page.screenshot({
      fullPage: options.fullPage,
      type: 'png',
    })

    // Validate the buffer
    if (!buffer || buffer.length === 0) {
      throw new Error('Screenshot capture returned empty buffer')
    }

    // Validate PNG signature (first 8 bytes)
    const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
    const bufferArray = new Uint8Array(buffer)
    const isValidPng = pngSignature.every((byte, i) => bufferArray[i] === byte)

    if (!isValidPng) {
      throw new Error('Screenshot capture returned invalid PNG data')
    }

    console.log(`[Browser] Screenshot captured: ${buffer.length} bytes`)
    return Buffer.from(buffer)
  } finally {
    // Always clean up, even on error
    // Close page first, then context
    if (page) {
      await page.close().catch(() => {})
    }
    if (context) {
      await context.close().catch(() => {})
    }
  }
}

/**
 * Graceful shutdown - close the browser.
 * Call this when the server is shutting down.
 */
export async function closeBrowser(): Promise<void> {
  if (browser) {
    console.log('[Browser] Closing browser...')
    await browser.close()
    browser = null
    console.log('[Browser] Browser closed')
  }
}

/**
 * Health check - is the browser responsive?
 */
export async function isBrowserHealthy(): Promise<boolean> {
  try {
    const browserInstance = await getBrowser()
    return browserInstance.isConnected()
  } catch {
    return false
  }
}
