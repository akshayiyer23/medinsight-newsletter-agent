import { NextRequest, NextResponse } from 'next/server'
import { load } from 'cheerio'

const FETCH_TIMEOUT_MS = 15_000

// Elements that are never part of the article body
const NOISE_SELECTORS = [
  'script', 'style', 'noscript', 'iframe',
  'nav', 'header', 'footer', 'aside',
  '[role="banner"]', '[role="navigation"]', '[role="complementary"]', '[role="contentinfo"]',
  '.nav', '.navigation', '.menu', '.sidebar', '.widget',
  '.header', '.footer', '.cookie', '.cookie-notice', '.cookie-banner',
  '.ad', '.ads', '.advertisement', '.social-share', '.related-posts',
  '.breadcrumb', '.breadcrumbs', '.site-header', '.site-footer',
].join(', ')

// Ordered list of selectors to try for the main article body
const CONTENT_SELECTORS = [
  'article',
  '[role="main"]',
  'main',
  '.article-content',
  '.article-body',
  '.post-content',
  '.post-body',
  '.entry-content',
  '.entry-body',
  '.content-body',
  '.page-content',
  '#article-body',
  '#content',
  '.content',
]

export async function POST(req: NextRequest) {
  let url: string
  try {
    ;({ url } = await req.json())
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  if (!url || typeof url !== 'string') {
    return NextResponse.json({ error: 'url is required' }, { status: 400 })
  }

  try {
    new URL(url)
  } catch {
    return NextResponse.json({ error: 'Invalid URL' }, { status: 400 })
  }

  let html: string
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })

    if (!response.ok) {
      return NextResponse.json(
        { error: `Site returned HTTP ${response.status}` },
        { status: 502 }
      )
    }

    const contentType = response.headers.get('content-type') ?? ''
    if (!contentType.includes('html')) {
      return NextResponse.json(
        { error: `Expected HTML but got ${contentType}` },
        { status: 422 }
      )
    }

    html = await response.text()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: `Fetch failed: ${message}` }, { status: 502 })
  }

  const $ = load(html)

  // Strip noise before extracting text
  $(NOISE_SELECTORS).remove()

  const title =
    $('meta[property="og:title"]').attr('content')?.trim() ||
    $('title').text().trim() ||
    $('h1').first().text().trim() ||
    ''

  // Try content selectors in order; fall back to body
  let rawText = ''
  for (const selector of CONTENT_SELECTORS) {
    const el = $(selector)
    if (el.length > 0) {
      rawText = el.text()
      break
    }
  }
  if (!rawText) {
    rawText = $('body').text()
  }

  // Normalize whitespace: collapse runs, preserve paragraph breaks
  const text = rawText
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  return NextResponse.json({ title, text })
}
