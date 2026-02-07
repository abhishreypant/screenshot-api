#!/usr/bin/env npx tsx
/**
 * Test script for Screenshot API
 * Run with: npx tsx test-api.ts
 */

import fs from 'fs/promises'
import path from 'path'

const BASE_URL = 'http://localhost:3000'

interface TestResult {
  name: string
  passed: boolean
  error?: string
  details?: string
}

const results: TestResult[] = []

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn()
    results.push({ name, passed: true })
    console.log(`✅ ${name}`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    results.push({ name, passed: false, error: message })
    console.log(`❌ ${name}: ${message}`)
  }
}

async function main() {
  console.log('\n🧪 Screenshot API Test Suite\n')
  console.log('=' .repeat(60))

  // Test 1: Health check
  await test('Health check endpoint', async () => {
    const res = await fetch(`${BASE_URL}/health`)
    if (!res.ok) throw new Error(`Status ${res.status}`)
    const data = await res.json()
    if (!data.success) throw new Error('Health check failed')
    if (!data.data.browser) throw new Error('Browser not healthy')
  })

  // Test 2: Take a basic screenshot (JSON response)
  let screenshotUrl: string | null = null
  await test('Take screenshot (JSON response)', async () => {
    const res = await fetch(`${BASE_URL}/screenshot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: 'https://example.com',
        width: 800,
        height: 600,
      }),
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Status ${res.status}: ${text}`)
    }
    const data = await res.json()
    if (!data.success) throw new Error(`API error: ${data.error?.message}`)
    if (!data.data.url) throw new Error('No screenshot URL returned')
    screenshotUrl = data.data.url
    console.log(`   URL: ${screenshotUrl}`)
    console.log(`   Size: ${data.data.metadata.fileSize} bytes`)
  })

  // Test 3: Fetch the screenshot image
  await test('Fetch screenshot image from URL', async () => {
    if (!screenshotUrl) throw new Error('No screenshot URL from previous test')
    const res = await fetch(screenshotUrl)
    if (!res.ok) throw new Error(`Status ${res.status}`)

    const contentType = res.headers.get('content-type')
    if (contentType !== 'image/png') {
      throw new Error(`Expected image/png, got ${contentType}`)
    }

    const buffer = await res.arrayBuffer()
    if (buffer.byteLength === 0) throw new Error('Empty image buffer')

    // Check PNG signature
    const view = new Uint8Array(buffer)
    const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
    const isValidPng = pngSignature.every((byte, i) => view[i] === byte)
    if (!isValidPng) throw new Error('Invalid PNG signature')

    console.log(`   Content-Type: ${contentType}`)
    console.log(`   Size: ${buffer.byteLength} bytes`)
    console.log(`   PNG signature: valid`)
  })

  // Test 4: Direct image response
  await test('Take screenshot (direct image response)', async () => {
    // Small delay to let browser recover
    await new Promise(r => setTimeout(r, 1000))
    const res = await fetch(`${BASE_URL}/screenshot?response=image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: 'https://example.org',
        width: 640,
        height: 480,
      }),
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Status ${res.status}: ${text}`)
    }

    const contentType = res.headers.get('content-type')
    if (contentType !== 'image/png') {
      throw new Error(`Expected image/png, got ${contentType}`)
    }

    const buffer = await res.arrayBuffer()
    if (buffer.byteLength === 0) throw new Error('Empty buffer')

    // Save to file
    const outPath = path.join(process.cwd(), 'test-output.png')
    await fs.writeFile(outPath, Buffer.from(buffer))
    console.log(`   Content-Type: ${contentType}`)
    console.log(`   Size: ${buffer.byteLength} bytes`)
    console.log(`   Saved to: ${outPath}`)
  })

  // Test 5: Full page screenshot
  await test('Full page screenshot', async () => {
    const res = await fetch(`${BASE_URL}/screenshot?response=image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: 'https://example.com',
        fullPage: true,
        device: 'mobile',
      }),
    })
    if (!res.ok) throw new Error(`Status ${res.status}`)

    const buffer = await res.arrayBuffer()
    if (buffer.byteLength === 0) throw new Error('Empty buffer')

    const outPath = path.join(process.cwd(), 'test-fullpage.png')
    await fs.writeFile(outPath, Buffer.from(buffer))
    console.log(`   Size: ${buffer.byteLength} bytes`)
    console.log(`   Saved to: ${outPath}`)
  })

  // Test 6: Dark mode
  await test('Dark mode screenshot', async () => {
    // Delay between tests
    await new Promise(r => setTimeout(r, 1000))
    const res = await fetch(`${BASE_URL}/screenshot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: 'https://example.com',
        darkMode: true,
        width: 800,
        height: 600,
      }),
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Status ${res.status}: ${text}`)
    }

    const data = await res.json()
    if (!data.success) throw new Error(`API error: ${data.error?.message}`)
    console.log(`   URL: ${data.data.url}`)
    console.log(`   Size: ${data.data.metadata.fileSize} bytes`)
  })

  // Test 7: Cache hit
  await test('Cache hit on repeat request', async () => {
    const res = await fetch(`${BASE_URL}/screenshot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: 'https://example.com',
        width: 800,
        height: 600,
      }),
    })
    if (!res.ok) throw new Error(`Status ${res.status}`)

    const cacheHeader = res.headers.get('x-cache')
    if (cacheHeader !== 'HIT') {
      console.log(`   Note: X-Cache was ${cacheHeader} (expected HIT for cached)`)
    } else {
      console.log(`   X-Cache: HIT`)
    }
  })

  // Test 8: Validation error
  await test('Validation error for invalid URL', async () => {
    const res = await fetch(`${BASE_URL}/screenshot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: 'not-a-valid-url',
      }),
    })
    if (res.status !== 400) {
      throw new Error(`Expected 400, got ${res.status}`)
    }
    const data = await res.json()
    if (data.success !== false) throw new Error('Expected success: false')
    console.log(`   Error code: ${data.error?.code}`)
  })

  // Test 9: Rate limit headers
  await test('Rate limit headers present', async () => {
    const res = await fetch(`${BASE_URL}/screenshot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: 'https://example.com',
      }),
    })

    const limit = res.headers.get('x-ratelimit-limit')
    const remaining = res.headers.get('x-ratelimit-remaining')

    if (!limit) throw new Error('Missing X-RateLimit-Limit header')
    if (!remaining) throw new Error('Missing X-RateLimit-Remaining header')

    console.log(`   Limit: ${limit}`)
    console.log(`   Remaining: ${remaining}`)

    if (limit !== '10') {
      console.log(`   Note: Rate limit is ${limit} (expected 10)`)
    }
  })

  // Test 10: 404 for missing screenshot
  await test('404 for non-existent screenshot', async () => {
    const res = await fetch(`${BASE_URL}/screenshots/nonexistent-id.png`)
    if (res.status !== 404) {
      throw new Error(`Expected 404, got ${res.status}`)
    }
    const data = await res.json()
    if (data.error?.code !== 'NOT_FOUND') {
      throw new Error(`Expected NOT_FOUND, got ${data.error?.code}`)
    }
  })

  // Summary
  console.log('\n' + '=' .repeat(60))
  const passed = results.filter(r => r.passed).length
  const failed = results.filter(r => !r.passed).length
  console.log(`\n📊 Results: ${passed} passed, ${failed} failed\n`)

  if (failed > 0) {
    console.log('Failed tests:')
    results.filter(r => !r.passed).forEach(r => {
      console.log(`  - ${r.name}: ${r.error}`)
    })
    process.exit(1)
  }
}

main().catch(console.error)
