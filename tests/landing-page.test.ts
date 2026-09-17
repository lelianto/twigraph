import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('../', import.meta.url))
const html = readFileSync(`${root}/build/index.html`, 'utf8')
const script = readFileSync(`${root}/build/script.js`, 'utf8')
const styles = readFileSync(`${root}/build/styles.css`, 'utf8')

describe('the landing page product contract', () => {
  it('has a clear page outline and an inspectable answer-to-source proof', () => {
    expect(html.match(/<h1\b/g)).toHaveLength(1)
    expect(html).toContain('class="skip-link"')
    expect(html).toMatch(/<nav[^>]+aria-label=/)
    expect(html).toContain('data-answer-proof')
    expect(html).toContain('data-source-proof')
  })

  it('states what works today without stale roadmap claims or snapshot numbers', () => {
    expect(html).toContain('Available today')
    expect(html).toContain('Not available yet')
    expect(html).toMatch(/\.txt/i)
    expect(html).toMatch(/\.md/i)
    expect(html).toMatch(/\.html/i)
    expect(html).toMatch(/Windows desktop/i)
    expect(html).toMatch(/read-only MCP/i)
    expect(html).toMatch(/No installer yet/i)
    expect(html).toMatch(/PDF.*DOCX/is)
    expect(html).toMatch(/local embeddings/i)
    expect(html).not.toContain('318')
    expect(html).not.toContain('95.89%')
    expect(html).not.toContain('desktop interface come next')
    expect(html).not.toContain('PDF, DOCX & HTML support')
  })

  it('offers a truthful source-based path to try the current build', () => {
    expect(html).toContain('Run from source')
    expect(html).not.toMatch(/>Download</i)
    expect(html).toContain('npm run fixture:generate')
    expect(html).toContain('npm run twigraph -- ask')
    expect(html).toContain('npm run desktop')
  })

  it('uses a local typeface and motion hooks without sacrificing fallbacks', () => {
    expect(styles).toContain('@font-face')
    expect(styles).toMatch(/url\(['"]?assets\/fonts\/[^'")]+\.woff2/)
    expect(styles).toContain('font-display: swap')
    expect(html).toContain('data-parallax')
    expect(script).toContain("classList.toggle('is-scrolled'")
    expect(styles).toMatch(/@media \(prefers-reduced-motion: reduce\)/)
  })

  it('keeps the navigation operable across desktop and mobile states', () => {
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('aria-controls="nav-links"')
    expect(script).toContain("menuButton?.setAttribute('aria-expanded', 'false')")
  })

  it('follows the system light or dark theme without JavaScript', () => {
    expect(styles).toContain('color-scheme: light dark')
    expect(styles).toMatch(/@media \(prefers-color-scheme: dark\)/)
  })

  it('keeps its progressive enhancement script local-only', () => {
    expect(script).not.toMatch(/\bfetch\s*\(/)
    expect(script).not.toMatch(/XMLHttpRequest|WebSocket|EventSource/)
    expect(script).not.toMatch(/telemetry|analytics/i)
    expect(styles).not.toMatch(/@import|url\(['"]?https?:\/\//i)
    expect(html).not.toMatch(/<(?:script|link)[^>]+https?:\/\//i)
  })
})
