'use client'

import { useState } from 'react'

type Tab = 'datadrip' | 'client'

interface GeneratedBlock {
  header: string
  body: string
  cta: string
  sourceUrl: string
}

interface BlockResult {
  url: string
  status: 'pending' | 'done' | 'error'
  block?: GeneratedBlock
  error?: string
}

// Data Drip cover
interface DDCover {
  headline: string
  subhead: string
}

// Client Newsletter email header
interface ClientCover {
  subject: string
  previewText?: string
  intro?: string
}

type Cover = DDCover | ClientCover

interface ExtractionResult {
  title: string
  text: string
}

function parseUrls(input: string): string[] {
  return input
    .split(/\s+/)
    .map(s => s.trim())
    .filter(s => {
      if (!s) return false
      try { new URL(s); return true } catch { return false }
    })
}

function stripCtaBrackets(cta: string): string {
  return cta.replace(/^\[+|\]+$/g, '').trim()
}

function blockToText(block: GeneratedBlock, tab: Tab): string {
  if (tab === 'client') {
    const bodyLine = block.body ? `${block.body}\n` : ''
    return `${block.header}\n${bodyLine}[${stripCtaBrackets(block.cta)}]`
  }
  return `${block.header}\n\n${block.body}\n\n${block.cta} ${block.sourceUrl}`
}

function editionToText(cover: Cover | null, results: BlockResult[], tab: Tab): string {
  const parts: string[] = []

  if (cover) {
    if (tab === 'client' && 'subject' in cover) {
      let headerText = `Subject: ${cover.subject}`
      if (cover.previewText) headerText += `\nPreview: ${cover.previewText}`
      if (cover.intro) headerText += `\n\n${cover.intro}`
      parts.push(headerText)
    } else if (tab === 'datadrip' && 'headline' in cover) {
      parts.push(`${cover.headline}\n${cover.subhead}`)
    }
  }

  results.forEach(r => {
    if (r.status === 'done' && r.block) parts.push(blockToText(r.block, tab))
  })

  if (tab === 'client') {
    parts.push('________________________________\n\nStay connected with us on LinkedIn and YouTube.')
  }

  return parts.join('\n\n\n')
}

export default function Home() {
  const [activeTab, setActiveTab] = useState<Tab>('datadrip')
  const [linksMap, setLinksMap] = useState<Record<Tab, string>>({ datadrip: '', client: '' })

  type Phase = 'idle' | 'blocks' | 'cover' | 'done'
  const [phase, setPhase] = useState<Phase>('idle')
  const [blockResults, setBlockResults] = useState<BlockResult[]>([])
  const [cover, setCover] = useState<Cover | null>(null)

  const [copiedIndex, setCopiedIndex] = useState<number | null>(null)
  const [copiedFull, setCopiedFull] = useState(false)

  const [testUrl, setTestUrl] = useState('')
  const [testResult, setTestResult] = useState<ExtractionResult | null>(null)
  const [testLoading, setTestLoading] = useState(false)
  const [testError, setTestError] = useState('')

  function setLinks(val: string) {
    setLinksMap(prev => ({ ...prev, [activeTab]: val }))
  }

  function switchTab(tab: Tab) {
    setActiveTab(tab)
    setPhase('idle')
    setBlockResults([])
    setCover(null)
  }

  async function copyBlock(index: number) {
    const result = blockResults[index]
    if (!result?.block) return
    await navigator.clipboard.writeText(blockToText(result.block, activeTab))
    setCopiedIndex(index)
    setTimeout(() => setCopiedIndex(null), 2000)
  }

  async function copyFull() {
    const text = editionToText(cover, blockResults, activeTab)
    if (!text) return
    await navigator.clipboard.writeText(text)
    setCopiedFull(true)
    setTimeout(() => setCopiedFull(false), 2000)
  }

  async function handleGenerate() {
    const urls = parseUrls(linksMap[activeTab])
    if (urls.length === 0) return
    const tab = activeTab

    setPhase('blocks')
    setCover(null)
    setBlockResults(urls.map(url => ({ url, status: 'pending' })))

    const results = await Promise.all(
      urls.map((url, i) =>
        fetch('/api/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url, tab }),
        })
          .then(async res => {
            const data = await res.json()
            if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
            setBlockResults(prev => {
              const next = [...prev]
              next[i] = { url, status: 'done', block: data }
              return next
            })
            return data as GeneratedBlock
          })
          .catch(err => {
            const error = err instanceof Error ? err.message : 'Unknown error'
            setBlockResults(prev => {
              const next = [...prev]
              next[i] = { url, status: 'error', error }
              return next
            })
            return null
          })
      )
    )

    const successBlocks = results.filter((b): b is GeneratedBlock => b !== null)

    if (successBlocks.length > 0) {
      setPhase('cover')
      try {
        const res = await fetch('/api/generate-cover', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ blocks: successBlocks, tab }),
        })
        const data = await res.json()
        if (res.ok) setCover(data)
      } catch {
        // cover failure is non-fatal
      }
    }

    setPhase('done')
  }

  async function handleTestExtraction() {
    const url = testUrl.trim()
    if (!url) return
    setTestLoading(true)
    setTestError('')
    setTestResult(null)
    try {
      const res = await fetch('/api/fetch-article', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      setTestResult(data)
    } catch (err) {
      setTestError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setTestLoading(false)
    }
  }

  const urls = parseUrls(linksMap[activeTab])
  const isGenerating = phase === 'blocks' || phase === 'cover'
  const hasUrls = urls.length > 0
  const doneCount = blockResults.filter(r => r.status === 'done').length
  const hasOutput = phase !== 'idle' && blockResults.length > 0

  const generateLabel = isGenerating
    ? phase === 'cover'
      ? 'Generating header...'
      : `Generating ${doneCount} of ${blockResults.length}...`
    : urls.length > 1
    ? `Generate ${urls.length} blocks`
    : 'Generate draft'

  const tabLabel: Record<Tab, string> = {
    datadrip: 'Data Drip',
    client: 'Client Newsletter',
  }

  const tabDescription: Record<Tab, string> = {
    datadrip:
      'Paste article, blog, webinar, or case study links — one per line. The agent fetches each source and drafts a Data Drip edition in MedInsight house style.',
    client:
      'Paste article, blog, webinar, or case study links — one per line. The agent fetches each source and drafts a Client Newsletter edition.',
  }

  const isClientCover = (c: Cover): c is ClientCover => 'subject' in c
  const isDDCover = (c: Cover): c is DDCover => 'headline' in c

  return (
    <div className="min-h-screen" style={{ background: '#131e2d' }}>

      {/* ── Top bar ── */}
      <header style={{ background: '#0c1520', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div className="max-w-4xl mx-auto px-8 py-4 flex items-center gap-2.5">
          <span className="text-[11px] font-bold tracking-[0.15em] uppercase"
                style={{ color: '#4a6080' }}>
            Milliman MedInsight
          </span>
          <span style={{ color: '#253345' }} className="select-none font-light">|</span>
          <span className="text-sm font-semibold" style={{ color: '#c8d8e8' }}>
            Newsletter Draft Agent
          </span>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-8 py-10">

        {/* ── Pill tabs ── */}
        <div className="flex gap-2 mb-8">
          {(['datadrip', 'client'] as Tab[]).map(tab => (
            <button
              key={tab}
              onClick={() => switchTab(tab)}
              className="px-4 py-2 rounded-full text-sm font-semibold transition-all duration-150"
              style={
                activeTab === tab
                  ? { background: '#ffffff', color: '#0c1520', boxShadow: '0 1px 4px rgba(0,0,0,0.3)' }
                  : { background: 'transparent', color: '#5a7a9a' }
              }
            >
              {tabLabel[tab]}
            </button>
          ))}
        </div>

        {/* ── Input card ── */}
        <div className="bg-white rounded-2xl p-8"
             style={{ boxShadow: '0 8px 40px rgba(0,0,0,0.35)' }}>

          <p className="text-sm leading-relaxed mb-7 max-w-lg"
             style={{ color: '#64748b' }}>
            {tabDescription[activeTab]}
          </p>

          <label htmlFor="links"
                 className="block text-[11px] font-bold tracking-[0.12em] uppercase mb-2.5"
                 style={{ color: '#94a3b8' }}>
            Article links — one per line
          </label>

          <textarea
            id="links"
            value={linksMap[activeTab]}
            onChange={e => setLinks(e.target.value)}
            placeholder={
              'https://medinsight.com/blog/cjr-x-starts-october-2027\n' +
              'https://medinsight.com/blog/why-vbc-still-fails\n' +
              'https://...'
            }
            rows={6}
            className="w-full rounded-xl font-mono text-sm leading-relaxed resize-y focus:outline-none transition-colors"
            style={{
              border: '1.5px solid #e2e8f0',
              background: '#f8fafc',
              color: '#1e293b',
              padding: '14px 16px',
            }}
            onFocus={e => { e.currentTarget.style.borderColor = '#3b82f6'; e.currentTarget.style.background = '#fff' }}
            onBlur={e => { e.currentTarget.style.borderColor = '#e2e8f0'; e.currentTarget.style.background = '#f8fafc' }}
          />

          <div className="flex items-center gap-4 mt-6">
            <button
              onClick={handleGenerate}
              disabled={isGenerating || !hasUrls}
              className="px-6 py-3 rounded-xl text-sm font-bold text-white transition-all duration-150 tracking-wide disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: isGenerating ? '#6b7280' : '#2563eb' }}
            >
              {generateLabel}
            </button>

            {isGenerating && (
              <span className="text-xs" style={{ color: '#94a3b8' }}>
                {phase === 'cover'
                  ? 'Almost done...'
                  : `${doneCount} of ${blockResults.length} blocks ready`}
              </span>
            )}
          </div>
        </div>

        {/* ── Draft output ── */}
        {hasOutput && (
          <div className="mt-10">

            {/* Section header */}
            <div className="flex items-center justify-between mb-4 px-1">
              <span className="text-[11px] font-bold tracking-[0.14em] uppercase"
                    style={{ color: '#3d5266' }}>
                Draft edition
              </span>

              {phase === 'done' && doneCount > 0 && (
                <button
                  onClick={copyFull}
                  className="text-xs font-semibold px-4 py-2 rounded-lg transition-all duration-150"
                  style={
                    copiedFull
                      ? { background: 'rgba(16,185,129,0.15)', color: '#34d399', border: '1px solid rgba(16,185,129,0.3)' }
                      : { background: 'rgba(255,255,255,0.07)', color: '#7a9ab8', border: '1px solid rgba(255,255,255,0.1)' }
                  }
                >
                  {copiedFull ? '✓ Copied' : 'Copy full edition'}
                </button>
              )}
            </div>

            <div className="space-y-4">

              {/* ── Cover / Email header card ── */}
              {(phase === 'cover' || phase === 'done') && (
                <div className="rounded-2xl overflow-hidden"
                     style={{ boxShadow: '0 8px 40px rgba(0,0,0,0.4)' }}>
                  {/* Dark band */}
                  <div className="px-8 py-4"
                       style={{ background: '#0c1520', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
                    <span className="text-[10px] font-bold tracking-[0.18em] uppercase"
                          style={{ color: '#60a5fa' }}>
                      {activeTab === 'client' ? 'Email header' : 'Cover'}
                    </span>
                  </div>

                  {/* White body */}
                  <div className="bg-white px-8 py-8">
                    {cover ? (
                      activeTab === 'datadrip' && isDDCover(cover) ? (
                        <>
                          <p className="text-[1.6rem] font-bold leading-tight max-w-2xl"
                             style={{ color: '#0f172a', letterSpacing: '-0.01em' }}>
                            {cover.headline}
                          </p>
                          <p className="mt-3 text-lg leading-snug" style={{ color: '#64748b' }}>
                            {cover.subhead}
                          </p>
                        </>
                      ) : activeTab === 'client' && isClientCover(cover) ? (
                        <div className="space-y-3">
                          <div>
                            <span className="text-[10px] font-bold tracking-wider uppercase"
                                  style={{ color: '#94a3b8' }}>Subject</span>
                            <p className="mt-1 text-base font-semibold" style={{ color: '#0f172a' }}>
                              {cover.subject}
                            </p>
                          </div>
                          {cover.previewText && (
                            <div>
                              <span className="text-[10px] font-bold tracking-wider uppercase"
                                    style={{ color: '#94a3b8' }}>Preview text</span>
                              <p className="mt-1 text-sm" style={{ color: '#475569' }}>
                                {cover.previewText}
                              </p>
                            </div>
                          )}
                          {cover.intro && (
                            <div>
                              <span className="text-[10px] font-bold tracking-wider uppercase"
                                    style={{ color: '#94a3b8' }}>Intro</span>
                              <p className="mt-1 text-sm" style={{ color: '#475569' }}>
                                {cover.intro}
                              </p>
                            </div>
                          )}
                        </div>
                      ) : null
                    ) : (
                      <p className="text-sm italic" style={{ color: '#94a3b8' }}>
                        {activeTab === 'client' ? 'Generating email header...' : 'Generating cover...'}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* ── Story block cards ── */}
              {blockResults.map((result, i) => (
                <div
                  key={i}
                  className="bg-white rounded-2xl px-8 py-7"
                  style={{ boxShadow: '0 4px 24px rgba(0,0,0,0.25)' }}
                >
                  {result.status === 'pending' && (
                    <div>
                      <p className="text-sm italic mb-2" style={{ color: '#94a3b8' }}>
                        Generating block {i + 1}...
                      </p>
                      <p className="text-xs font-mono truncate" style={{ color: '#cbd5e1' }}>
                        {result.url}
                      </p>
                    </div>
                  )}

                  {result.status === 'error' && (
                    <div>
                      <p className="text-sm font-semibold mb-1.5" style={{ color: '#ef4444' }}>
                        Block {i + 1} failed: {result.error}
                      </p>
                      <p className="text-xs font-mono truncate" style={{ color: '#94a3b8' }}>
                        {result.url}
                      </p>
                    </div>
                  )}

                  {result.status === 'done' && result.block && (
                    <>
                      <div className="flex items-start justify-between gap-6 mb-4">
                        <p className="text-base font-bold leading-snug" style={{ color: '#0f172a' }}>
                          {result.block.header}
                        </p>
                        <button
                          onClick={() => copyBlock(i)}
                          className="flex-none text-xs font-semibold px-3 py-1.5 rounded-lg transition-all duration-150 whitespace-nowrap mt-0.5"
                          style={
                            copiedIndex === i
                              ? { background: '#f0fdf4', color: '#16a34a', border: '1px solid #bbf7d0' }
                              : { background: '#f8fafc', color: '#94a3b8', border: '1px solid #e2e8f0' }
                          }
                        >
                          {copiedIndex === i ? '✓ Copied' : 'Copy'}
                        </button>
                      </div>

                      {/* Body — shown for both tabs; often empty for client */}
                      {result.block.body && (
                        <p className="text-sm leading-7 mb-4" style={{ color: '#475569' }}>
                          {result.block.body}
                        </p>
                      )}

                      {/* CTA */}
                      <div style={{ borderTop: result.block.body ? '1px solid #f1f5f9' : 'none', paddingTop: result.block.body ? '1.25rem' : '0' }}>
                        {activeTab === 'client' ? (
                          <a
                            href={result.block.sourceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm font-semibold transition-colors"
                            style={{ color: '#1e293b' }}
                          >
                            [{stripCtaBrackets(result.block.cta)}]
                          </a>
                        ) : (
                          <a
                            href={result.block.sourceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm font-semibold transition-colors"
                            style={{ color: '#2563eb' }}
                          >
                            {result.block.cta} &rarr;
                          </a>
                        )}
                      </div>
                    </>
                  )}
                </div>
              ))}

              {/* ── Client newsletter footer ── */}
              {activeTab === 'client' && phase === 'done' && doneCount > 0 && (
                <div className="bg-white rounded-2xl px-8 py-5"
                     style={{ boxShadow: '0 4px 24px rgba(0,0,0,0.25)' }}>
                  <p className="text-sm" style={{ color: '#94a3b8', borderTop: '1px solid #e2e8f0', paddingTop: '1.25rem' }}>
                    ________________________________
                  </p>
                  <p className="text-sm mt-2" style={{ color: '#475569' }}>
                    Stay connected with us on LinkedIn and YouTube.
                  </p>
                </div>
              )}

            </div>
          </div>
        )}

        {/* ── Dev: test link extraction (collapsed) ── */}
        <details className="mt-16"
                 style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '1.5rem' }}>
          <summary
            className="text-[11px] font-bold tracking-[0.14em] uppercase cursor-pointer select-none transition-colors"
            style={{ color: '#2d4057', listStyle: 'none' }}
          >
            › Dev: test link extraction
          </summary>

          <div className="mt-5 rounded-xl p-6"
               style={{ background: 'rgba(12,21,32,0.6)', border: '1px solid rgba(255,255,255,0.07)' }}>
            <div className="flex gap-2">
              <input
                type="url"
                value={testUrl}
                onChange={e => setTestUrl(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleTestExtraction()}
                placeholder="https://..."
                className="flex-1 rounded-lg text-sm focus:outline-none"
                style={{
                  background: '#0c1520',
                  border: '1px solid rgba(255,255,255,0.1)',
                  color: '#cbd5e1',
                  padding: '8px 14px',
                }}
              />
              <button
                onClick={handleTestExtraction}
                disabled={testLoading || !testUrl.trim()}
                className="px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                style={{ background: '#1e3048', color: '#7a9ab8', border: '1px solid rgba(255,255,255,0.08)' }}
              >
                {testLoading ? 'Fetching...' : 'Test extraction'}
              </button>
            </div>

            {testError && (
              <p className="mt-3 text-sm" style={{ color: '#f87171' }}>{testError}</p>
            )}

            {testResult && (
              <div className="mt-4 space-y-2">
                <p className="text-xs" style={{ color: '#64748b' }}>
                  <span className="font-medium" style={{ color: '#7a9ab8' }}>Title: </span>
                  {testResult.title}
                </p>
                <textarea
                  readOnly
                  value={testResult.text}
                  rows={12}
                  className="w-full rounded-lg text-xs font-mono resize-y focus:outline-none"
                  style={{
                    background: '#0c1520',
                    border: '1px solid rgba(255,255,255,0.07)',
                    color: '#4a6080',
                    padding: '12px 14px',
                  }}
                />
                <p className="text-xs" style={{ color: '#3d5266' }}>
                  {testResult.text.length.toLocaleString()} characters extracted
                </p>
              </div>
            )}
          </div>
        </details>

      </main>
    </div>
  )
}
