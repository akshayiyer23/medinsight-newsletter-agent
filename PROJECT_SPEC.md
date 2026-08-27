# Data Drip + Client Newsletter Agent — Build Spec

## What this is
An internal web app for the Milliman MedInsight marketing team.
The user pastes in article links. The app fetches each link,
reads the content, and uses Claude to draft a newsletter in the
team's exact house voice. Output is header + body + CTA blocks,
assembled into a full draft the user reviews and ships.

## Stack
- Next.js (App Router) + TypeScript
- Tailwind CSS for styling
- Anthropic Claude API (model: claude-sonnet-4-6) for generation
- Server-side link fetching + HTML-to-readable-text extraction
- Deploy target: Vercel
- API key from environment variable ANTHROPIC_API_KEY, never hardcoded

## Two tabs
The app has two tabs. Same pipeline underneath (paste links ->
fetch -> extract text -> Claude drafts in house voice -> review),
different output format and different example set per tab.

TAB 1 — Data Drip (LinkedIn newsletter) — BUILD FIRST
  - Examples live in /examples/datadrip/
  - Output: cover headline + short second line, then story blocks
  - Each block: HEADER (leads with "Blog:/Webinar:/Case study:"
    then topic) -> BODY (3-4 sentences, names real people +
    titles from source, leads with the number/stakes) ->
    CTA (short: "Read the blog.", "Register for the webinar here.")

TAB 2 — Client Newsletter (email) — BUILD SECOND
  - Examples live in /examples/client/
  - Starts with a SUBJECT LINE (short, specific, benefit or
    curiosity driven)
  - Optional one-line intro previewing the edition (some have it,
    some don't)
  - Then a list of blocks. Client blocks are LIGHT. Most are just:
      HEADER (bold, specific, often a hook or question)
      + optional single sentence of context (many blocks skip this)
      + CTA (bracketed, action-first: [Register now], [Read the blog],
        [Learn more], [Watch the video])
    A block may have TWO CTAs when the source has two resources.
  - The CTA verb matches the content type: register for webinars/
    events, read for blogs/case studies, watch for videos.
  - Ends with footer: "Stay connected with us on LinkedIn and YouTube."
  - Tone: lighter, punchier, more scannable than Data Drip.

KEY DIFFERENCE FROM DATA DRIP: Data Drip blocks have 3-4 sentence
educational bodies. Client blocks are mostly header + CTA with
little or no body. Do not pad client blocks with Data Drip-length
paragraphs.

CTA LINKS: Each block is generated from a source link the user
pasted. The CTA for that block must link to that same source URL.
Output the CTA as the action phrase with the URL attached (so it's
click-ready), e.g. "Read the full report." linked to the pasted
URL. In the Client tab, use the bracketed style [Read the blog]
linked to the URL.

## The Data Drip story block structure (from 3 real editions)
- HEADER: leads with content type then topic ("Webinar: ...",
  "Blog: ...", "Case study: ...", "Featured session: ...")
- BODY: 2-4 sentences. Summarizes the source. Names real people
  and their real titles from the source. Leads with the key number
  or the stakes. Educates, does not hype.
- CTA: short action phrase, not a sentence.

## Cover output (v1)
Text only. Output a bold headline and a short second line.
Do NOT generate a graphic. The user drops the text into Canva.

## Voice — match house style AND strip AI slop
Output must read like the real editions in /examples, not generic AI.

1. MATCH MedInsight house style (governed by /examples):
   - Mirror tone, sentence length, and rhythm of the examples
   - Plain, confident, declarative. Educate, don't sell.
   - Lead with the number or the stakes
   - Name real people + real titles from the source
   - CTAs are short action phrases
   - Match the punctuation and formatting the examples use

2. STRIP AI slop:
   - No throat-clearing openers ("In today's landscape...")
   - No empty adverbs, no hype words, no fake enthusiasm
   - No formulaic "not just X, but Y" contrasts
   - Active voice, human subjects, direct statements
   - No AI-style em dashes ("—"). Use the punctuation the
     example editions actually use.

RULE: When stop-slop and the examples conflict on style, the
examples win. Goal: a MedInsight reader cannot tell it was AI-drafted.

## Reference examples
Load ALL examples for the active tab into the generation prompt
every time. Data Drip tab loads only /examples/datadrip/.
Client tab loads only /examples/client/. Never mix them.

## Hard constraints
- Draft only. NEVER auto-post anywhere.
- No private/confidential company data hardcoded. Public links only.
- API key in env var only.

## Build order (do not skip ahead)
1. Basic Next.js app: Data Drip tab with a textarea for links
   and a Generate button
2. Server route: fetch one link, extract readable text (test it)
3. Claude API call: text + datadrip examples in, one
   {header, body, cta} block out
4. Get ONE block rendering on screen end to end
5. Handle multiple links -> multiple blocks + cover headline
6. Styling + a copy button per block
7. Deploy to Vercel
8. THEN add Tab 2 (Client Newsletter) with its own format + examples
