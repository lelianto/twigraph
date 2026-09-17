import { rm } from 'node:fs/promises'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { TwigraphError } from '@twigraph/shared'

import { createHtmlParser } from '../src/parsers/html'
import { makeTempDir, parseInputFor, writeFixture } from './helpers'

const parser = createHtmlParser()

let root = ''

beforeAll(async () => {
  root = await makeTempDir('twigraph-html-')
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

const parse = async (relativePath: string) => parser.parse(await parseInputFor(root, relativePath))

const lines = (...parts: readonly string[]): string => `${parts.join('\n')}\n`

describe('the html parser', () => {
  it('claims .html and .htm', () => {
    expect(parser.id).toBe('html')
    expect(parser.extensions).toEqual(['.html', '.htm'])
    expect(parser.supports('.html')).toBe(true)
    expect(parser.supports('.htm')).toBe(true)
    expect(parser.supports('.txt')).toBe(false)
  })

  it('extracts title, headings, paragraphs, lists, tables and code', async () => {
    await writeFixture(
      root,
      'doc.html',
      lines(
        '<!DOCTYPE html>',
        '<html>',
        '<head>',
        '  <title>Sample Page</title>',
        '  <style>body { color: red; }</style>',
        '  <script>console.log("ignore me")</script>',
        '</head>',
        '<body>',
        '  <h1>Main Heading</h1>',
        '  <p>First paragraph with <strong>bold</strong> and <a href="#">link</a>.</p>',
        '  <blockquote>A notable quote</blockquote>',
        '  <h2>Sub section</h2>',
        '  <ul>',
        '    <li>Item one</li>',
        '    <li>Item two</li>',
        '    <li></li>',
        '  </ul>',
        '  <pre><code>const x = 42;</code></pre>',
        '  <table>',
        '    <tr><th>Col 1</th><th>Col 2</th></tr>',
        '    <tr><td>Val 1</td><td>Val 2</td></tr>',
        '  </table>',
        '</body>',
        '</html>',
      ),
    )

    const document = await parse('doc.html')

    expect(document.metadata.title).toBe('Sample Page')
    expect(document.blocks).toEqual([
      { kind: 'heading', level: 1, text: 'Main Heading' },
      { kind: 'paragraph', text: 'First paragraph with bold and link.' },
      { kind: 'paragraph', text: 'A notable quote' },
      { kind: 'heading', level: 2, text: 'Sub section' },
      { kind: 'list', text: 'Item one\nItem two' },
      { kind: 'code', text: 'const x = 42;' },
      { kind: 'table', text: '| Col 1 | Col 2 |\n| Val 1 | Val 2 |' },
    ])
  })

  it('decodes html entities properly including numeric and hex', async () => {
    await writeFixture(
      root,
      'entities.html',
      '<p>Fish &amp; Chips &gt; &quot;Burgers&quot; &lt;3 &#65; &#x42;</p>',
    )

    const document = await parse('entities.html')
    expect(document.blocks).toEqual([
      { kind: 'paragraph', text: 'Fish & Chips > "Burgers" <3 A B' },
    ])
  })

  it('falls back to plain paragraph when no block tags are present', async () => {
    await writeFixture(
      root,
      'plain.html',
      '<div>Raw untagged content with <em>styling</em> and text.</div>',
    )

    const document = await parse('plain.html')
    expect(document.blocks).toEqual([
      { kind: 'paragraph', text: 'Raw untagged content with styling and text.' },
    ])
  })

  it('reports empty document when html has no body text', async () => {
    await writeFixture(
      root,
      'empty.html',
      '<html><head><script>alert(1)</script></head><body>   </body></html>',
    )

    await expect(parse('empty.html')).rejects.toSatisfy((error) => {
      expect(error).toBeInstanceOf(TwigraphError)
      expect((error as TwigraphError).code).toBe('PARSE_EMPTY')
      return true
    })
  })
})
