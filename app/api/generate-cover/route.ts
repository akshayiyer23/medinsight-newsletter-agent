import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import fs from 'fs'
import path from 'path'

type Tab = 'datadrip' | 'client'

interface Block {
  header: string
  body: string
  cta: string
  sourceUrl: string
}

const DD_COVER_TOOL: Anthropic.Tool = {
  name: 'output_cover',
  description: 'Output the Data Drip LinkedIn newsletter cover',
  input_schema: {
    type: 'object',
    properties: {
      headline: { type: 'string', description: '6–10 word stakes-first cover headline' },
      subhead:  { type: 'string', description: '6–12 word follow-on subhead' },
    },
    required: ['headline', 'subhead'],
  },
}

const CLIENT_COVER_TOOL: Anthropic.Tool = {
  name: 'output_cover',
  description: 'Output the Client Newsletter email header',
  input_schema: {
    type: 'object',
    properties: {
      subject:     { type: 'string', description: '5–10 word email subject line' },
      previewText: { type: 'string', description: '10–20 word preview text previewing key topics' },
      intro:       { type: 'string', description: 'One-sentence intro, or empty string if not needed' },
    },
    required: ['subject', 'previewText', 'intro'],
  },
}

function stripDashes(s: string): string {
  return s
    .replace(/\s*--\s*/g, ', ')
    .replace(/\s*—\s*/g, ', ')
    .replace(/,\s*$/, '.')
    .replace(/,(\s*[.?!])/, '$1')
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

function loadExamples(dir: string): string {
  const examplesDir = path.join(process.cwd(), 'examples', dir)
  const files = fs.readdirSync(examplesDir).filter(f => f.endsWith('.md')).sort()
  return files
    .map((f, i) => `=== EXAMPLE ${i + 1} (${f}) ===\n${fs.readFileSync(path.join(examplesDir, f), 'utf-8').trim()}`)
    .join('\n\n')
}

function buildDDCoverPrompt(blocksText: string, examples: string): string {
  return `You are writing the cover for a Data Drip LinkedIn newsletter edition from Milliman MedInsight.

Study these real Data Drip editions to learn the exact cover format:

${examples}

---

COVER FORMAT RULES:
- Headline: 6–10 words. Stakes-first, declarative, specific. Names the single biggest story or through-line. No hype words. No "your" or "our". No question marks.
- Subhead: 6–12 words. Teases the answer or extends the tension. Natural follow-on to the headline.
- The character — must never appear. Use a comma, period, or colon instead.

Story blocks in this edition:

${blocksText}`
}

function buildClientCoverPrompt(blocksText: string, examples: string): string {
  return `You are writing the email header for a Milliman MedInsight Client Newsletter edition.

Study these real client newsletter editions to see how subject lines, preview text, and intros are written:

${examples}

---

EMAIL HEADER RULES:
- subject: 5–10 words. Short, direct, specific. Benefit-driven or curiosity-driven. No generic phrases like "What's new."
- previewText: 10–20 words previewing 2–3 key topics. Gives the reader a reason to open.
- intro: One short sentence introducing the edition. Empty string if not needed.
- The character — must never appear in any field.

Story blocks in this edition:

${blocksText}`
}

export async function POST(req: NextRequest) {
  let blocks: Block[], tab: Tab
  try {
    const body = await req.json()
    blocks = body.blocks
    tab = body.tab === 'client' ? 'client' : 'datadrip'
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  if (!blocks || !Array.isArray(blocks) || blocks.length === 0) {
    return NextResponse.json({ error: 'blocks array is required' }, { status: 400 })
  }

  let examples: string
  try {
    examples = loadExamples(tab === 'client' ? 'client' : 'datadrip')
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: `Failed to load examples: ${msg}` }, { status: 500 })
  }

  const blocksText = blocks
    .map((b, i) => `Block ${i + 1}:\nHeader: ${b.header}${b.body ? `\nBody: ${b.body}` : ''}`)
    .join('\n\n')

  const tool = tab === 'client' ? CLIENT_COVER_TOOL : DD_COVER_TOOL
  const prompt = tab === 'client'
    ? buildClientCoverPrompt(blocksText, examples)
    : buildDDCoverPrompt(blocksText, examples)

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  let cover: Record<string, string>
  try {
    const message = await withRetry(() =>
      anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 256,
        tools: [tool],
        tool_choice: { type: 'tool', name: 'output_cover' },
        messages: [{ role: 'user', content: prompt }],
      })
    )

    const toolUse = message.content.find(b => b.type === 'tool_use')
    if (!toolUse || toolUse.type !== 'tool_use') {
      return NextResponse.json({ error: 'Claude did not return a tool_use block' }, { status: 500 })
    }
    cover = toolUse.input as Record<string, string>
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: `Claude API error: ${msg}` }, { status: 500 })
  }

  // Hard cleanup for client tab: strip em dashes and double hyphens from all cover fields.
  if (tab === 'client') {
    const cleaned: Record<string, string> = {}
    for (const [k, v] of Object.entries(cover)) {
      cleaned[k] = typeof v === 'string' ? stripDashes(v) : v
    }
    return NextResponse.json({ ...cleaned, tab })
  }

  return NextResponse.json({ ...cover, tab })
}
