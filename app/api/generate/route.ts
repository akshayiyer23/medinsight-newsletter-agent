import { NextRequest, NextResponse } from 'next/server'
import { load } from 'cheerio'
import Anthropic from '@anthropic-ai/sdk'
import fs from 'fs'
import path from 'path'

type Tab = 'datadrip' | 'client'

const FETCH_TIMEOUT_MS = 15_000

const NOISE_SELECTORS = [
  'script', 'style', 'noscript', 'iframe',
  'nav', 'header', 'footer', 'aside',
  '[role="banner"]', '[role="navigation"]', '[role="complementary"]', '[role="contentinfo"]',
  '.nav', '.navigation', '.menu', '.sidebar', '.widget',
  '.header', '.footer', '.cookie', '.cookie-notice', '.cookie-banner',
  '.ad', '.ads', '.advertisement', '.social-share', '.related-posts',
  '.breadcrumb', '.breadcrumbs', '.site-header', '.site-footer',
].join(', ')

const CONTENT_SELECTORS = [
  'article', '[role="main"]', 'main',
  '.article-content', '.article-body', '.post-content', '.post-body',
  '.entry-content', '.entry-body', '.content-body', '.page-content',
  '#article-body', '#content', '.content',
]

// Tool schema — shared for both tabs (body is empty string for light client blocks)
const BLOCK_TOOL: Anthropic.Tool = {
  name: 'output_block',
  description: 'Output the newsletter story block',
  input_schema: {
    type: 'object',
    properties: {
      header: { type: 'string', description: 'The block header / title line' },
      body:   { type: 'string', description: 'Body text. Empty string when no context is needed.' },
      cta:    { type: 'string', description: 'CTA action text — no brackets, no URL (e.g. "Read the blog")' },
    },
    required: ['header', 'body', 'cta'],
  },
}

// Strips em dashes and double hyphens from client output, replacing with a comma or period.
// This is a hard post-processing step — prompt instructions alone are not reliable enough.
function stripDashes(s: string): string {
  return s
    .replace(/\s*--\s*/g, ', ')
    .replace(/\s*—\s*/g, ', ')
    .replace(/,\s*$/, '.')        // trailing comma → period
    .replace(/,(\s*[.?!])/, '$1') // comma before punctuation → just punctuation
    .trim()
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 2): Promise<T> {
  for (let i = 0; i < attempts; i++) {
    try { return await fn() }
    catch (err) {
      if (i === attempts - 1) throw err
      await new Promise(r => setTimeout(r, 800))
    }
  }
  throw new Error('unreachable')
}

async function fetchAndExtract(url: string): Promise<{ title: string; text: string }> {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })

  if (!response.ok) throw new Error(`Site returned HTTP ${response.status}`)
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('html')) throw new Error(`Expected HTML but got ${contentType}`)

  const html = await response.text()
  const $ = load(html)
  $(NOISE_SELECTORS).remove()

  const title =
    $('meta[property="og:title"]').attr('content')?.trim() ||
    $('title').text().trim() ||
    $('h1').first().text().trim() || ''

  let rawText = ''
  for (const selector of CONTENT_SELECTORS) {
    const el = $(selector)
    if (el.length > 0) { rawText = el.text(); break }
  }
  if (!rawText) rawText = $('body').text()

  const text = rawText
    .split('\n').map(l => l.trim()).filter(l => l.length > 0)
    .join('\n').replace(/\n{3,}/g, '\n\n').trim()

  return { title, text }
}

function loadExamples(dir: string): string {
  const examplesDir = path.join(process.cwd(), 'examples', dir)
  const files = fs.readdirSync(examplesDir).filter(f => f.endsWith('.md')).sort()
  return files
    .map((f, i) => `=== EXAMPLE ${i + 1} (${f}) ===\n${fs.readFileSync(path.join(examplesDir, f), 'utf-8').trim()}`)
    .join('\n\n')
}

function buildDataDripPrompt(title: string, url: string, text: string, examples: string): string {
  const truncated = text.length > 8000 ? text.slice(0, 8000) + '\n[... truncated]' : text
  return `Study these real Data Drip editions carefully. They define the exact house voice, format, and rhythm you must match — they are your primary authority:

${examples}

---

Secondary voice rules (when they conflict with the examples above, THE EXAMPLES WIN):
- Plain, confident, declarative. Educate, don't sell.
- Lead with the single biggest stake or tension. Never open with a preamble.
- No throat-clearing openers ("In today's complex landscape...", "As healthcare evolves...")
- No hype words or empty adverbs ("innovative", "cutting-edge", "powerful", "exciting")
- No "not just X, but Y" constructions. No fake enthusiasm.
- Active voice, human subjects, direct declarative statements.

EM DASH RULE (hard): The character — must never appear in header, body, or cta. Rewrite with a comma, colon, or period.

---

BODY DENSITY: Write 3–4 sentences. Each sentence carries ONE idea — do not cram multiple technical specifics into a single sentence. Rhythm:
1. Stakes or tension: the single biggest reason this matters right now.
2. Central argument or finding — name real people here only if the source clearly presents them as the subject expert (not just a marketing byline).
3. What the piece delivers: what the reader will get by reading it.
4. Urgency close: only add this if there is a real deadline or consequence.

NAMING PEOPLE: Only name someone when the source clearly presents them as the expert making that argument — a webinar presenter, named researcher, quoted practitioner. A marketing byline ("By Sarah Quinn, Director of Marketing") does not qualify; in that case write "The piece explains..." or "The blog argues..."

---

Source article:

TITLE: ${title || '(no title found)'}
URL: ${url}

${truncated}

---

Draft ONE Data Drip story block for this source.

Header: content-type prefix (e.g. "Blog:", "Webinar:", "Case study:", "Research:") followed by a specific, concrete topic description — exactly as shown in the examples.
Body: 3–4 sentences, one idea per sentence, house style exactly.
CTA: a short action phrase — no URL, no brackets (e.g. "Read the blog." or "Register for the webinar.")`
}

function buildClientPrompt(title: string, url: string, text: string, examples: string): string {
  const truncated = text.length > 8000 ? text.slice(0, 8000) + '\n[... truncated]' : text
  return `You are writing a story block for the Milliman MedInsight Client Newsletter — a brief, scannable email. Study these real client newsletter editions. They are your primary authority on format:

${examples}

---

CLIENT NEWSLETTER BLOCK RULES:

This is NOT a LinkedIn newsletter. Do not write educational paragraphs.

BODY LENGTH: About half the blocks in the examples have one sentence of body text; the other half are header + CTA only. Use this decision rule:
  - Write ONE sentence when the source has a real value prop worth naming (what the webinar covers, what a research piece found, what an event is about, what a product does).
  - Leave body empty only when the header already says everything (pure event registration, navigational link with no context to add).
  - Never write more than two sentences. Never write three.

ONE-SENTENCE BODY STYLE — match the examples:
  - Webinar: "Join us [date] to explore [specific topic]."
  - Article/blog: "[One-sentence summary of the actual finding or argument]."
  - Product/feature: "[One sentence on what it does or why it matters]."
  - Event: "[One sentence on what attendees will get]."

HEADER: Short, direct, specific. Match the style from the examples:
  - Content-type prefix: "Webinar: [topic]", "Article: [topic]", "Client story: [topic]"
  - Time urgency: "3 months away: Join us at [event]"
  - Plain declarative: "Turning physician performance insights into action"
  - Announcement: "Introducing [product]", "Spots open: [event]"

CTA VERB — matches content type:
  - Blog/article: Read the blog | Read the article
  - Webinar/event: Register now | Register for the webinar | Reserve your spot
  - Video: Watch the video
  - Case study: Read the case study
  - General: Learn more

EM DASH RULE: The character — must never appear in any field.

---

Source:

TITLE: ${title || '(no title found)'}
URL: ${url}

${truncated}

---

Draft ONE client newsletter block for this source.

Header: short, direct, specific — content-type prefix or plain declarative, matching the examples exactly.
Body: one short sentence if the source has a real value prop to convey; empty string "" only if the header already says everything.
CTA: action text only — no brackets, no URL (e.g. "Register now" not "[Register now]")`
}

export async function POST(req: NextRequest) {
  let url: string, tab: Tab
  try {
    const body = await req.json()
    url = body.url
    tab = body.tab === 'client' ? 'client' : 'datadrip'
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  if (!url || typeof url !== 'string') {
    return NextResponse.json({ error: 'url is required' }, { status: 400 })
  }
  try { new URL(url) } catch {
    return NextResponse.json({ error: 'Invalid URL' }, { status: 400 })
  }

  let title: string, text: string
  try {
    ;({ title, text } = await fetchAndExtract(url))
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: `Failed to fetch article: ${msg}` }, { status: 502 })
  }

  if (!text) {
    return NextResponse.json({ error: 'Could not extract article text from that URL' }, { status: 422 })
  }

  let examples: string
  try {
    examples = loadExamples(tab === 'client' ? 'client' : 'datadrip')
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: `Failed to load examples: ${msg}` }, { status: 500 })
  }

  const prompt = tab === 'client'
    ? buildClientPrompt(title, url, text, examples)
    : buildDataDripPrompt(title, url, text, examples)

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  let block: { header: string; body: string; cta: string }
  try {
    const message = await withRetry(() =>
      anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        tools: [BLOCK_TOOL],
        tool_choice: { type: 'tool', name: 'output_block' },
        messages: [{ role: 'user', content: prompt }],
      })
    )

    const toolUse = message.content.find(b => b.type === 'tool_use')
    if (!toolUse || toolUse.type !== 'tool_use') {
      return NextResponse.json({ error: 'Claude did not return a tool_use block' }, { status: 500 })
    }
    block = toolUse.input as { header: string; body: string; cta: string }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: `Claude API error: ${msg}` }, { status: 500 })
  }

  if (!block.header || !block.cta) {
    return NextResponse.json({ error: 'Claude returned an incomplete block' }, { status: 500 })
  }

  // Strip any surrounding brackets Claude may include despite instructions (e.g. "[Read the blog]" → "Read the blog")
  const cta = (block.cta ?? '').replace(/^\[+|\]+$/g, '').trim()

  // Hard cleanup for client tab: strip em dashes and double hyphens from all fields.
  // Applied after Claude returns — prompt instructions alone are not reliable enough.
  if (tab === 'client') {
    return NextResponse.json({
      header: stripDashes(block.header),
      body: stripDashes(block.body ?? ''),
      cta: stripDashes(cta),
      sourceUrl: url,
    })
  }

  return NextResponse.json({
    header: block.header,
    body: block.body ?? '',
    cta,
    sourceUrl: url,
  })
}
