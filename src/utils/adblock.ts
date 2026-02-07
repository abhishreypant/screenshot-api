// =============================================================================
// ADBLOCK - Block ads and trackers during screenshot capture.
//
// Strategy: Block requests to known ad/tracker domains.
// This is simpler and faster than parsing EasyList rules.
//
// Trade-off: Less comprehensive than full ad blockers, but:
// - Zero runtime parsing overhead
// - No external dependencies
// - Covers 90% of common cases
// - Easy to extend
// =============================================================================

/**
 * Common ad and tracker domains.
 * Curated from public blocklists and common patterns.
 *
 * This is a subset - in production you might load from a file
 * or use a service like AdGuard's DNS-level blocking.
 */
const AD_DOMAINS = new Set([
  // Google Ads
  'doubleclick.net',
  'googlesyndication.com',
  'googleadservices.com',
  'google-analytics.com',
  'googletagmanager.com',
  'googletagservices.com',
  'pagead2.googlesyndication.com',

  // Facebook
  'facebook.net',
  'fbcdn.net',
  'connect.facebook.net',

  // Twitter/X
  'ads-twitter.com',
  'analytics.twitter.com',

  // Amazon
  'amazon-adsystem.com',
  'aax.amazon-adsystem.com',

  // Common ad networks
  'adnxs.com',
  'adsrvr.org',
  'adform.net',
  'criteo.com',
  'criteo.net',
  'outbrain.com',
  'taboola.com',
  'pubmatic.com',
  'rubiconproject.com',
  'openx.net',
  'casalemedia.com',
  'moatads.com',
  'quantserve.com',
  'scorecardresearch.com',
  'serving-sys.com',

  // Tracking
  'hotjar.com',
  'mixpanel.com',
  'amplitude.com',
  'segment.io',
  'segment.com',
  'optimizely.com',
  'crazyegg.com',
  'mouseflow.com',
  'fullstory.com',
  'clarity.ms',

  // Pop-ups / Overlays
  'popads.net',
  'popcash.net',
  'propellerads.com',

  // Generic patterns (subdomains)
  'ads.linkedin.com',
  'ad.doubleclick.net',
])

/**
 * Patterns to match in URLs (for cases where domain matching isn't enough)
 */
const AD_URL_PATTERNS = [
  /\/ads\//i,
  /\/ad\//i,
  /\/advert/i,
  /\/banner/i,
  /\/sponsor/i,
  /\/tracking/i,
  /\/analytics\.js/i,
  /\/gtag\/js/i,
  /\/pixel\//i,
  /\/beacon/i,
]

/**
 * Check if a URL should be blocked.
 *
 * @param url - The URL being requested
 * @returns true if the URL should be blocked
 */
export function shouldBlockUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    const hostname = parsed.hostname.toLowerCase()

    // Check exact domain match
    if (AD_DOMAINS.has(hostname)) {
      return true
    }

    // Check if it's a subdomain of a blocked domain
    for (const blockedDomain of AD_DOMAINS) {
      if (hostname.endsWith(`.${blockedDomain}`)) {
        return true
      }
    }

    // Check URL patterns
    for (const pattern of AD_URL_PATTERNS) {
      if (pattern.test(url)) {
        return true
      }
    }

    return false
  } catch {
    // If we can't parse the URL, don't block it
    return false
  }
}

/**
 * Resource types that are commonly used for ads.
 * We can be more aggressive blocking these.
 */
export const AD_RESOURCE_TYPES = new Set([
  'image', // Ad banners
  'media', // Video ads
  'script', // Ad scripts
  'xhr', // Tracking beacons
  'fetch', // Modern tracking
])
