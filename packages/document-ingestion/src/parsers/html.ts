import type { Block, ParsedDocument, ParseInput } from '@twigraph/shared'

import type { VersionedParser } from '../parser'
import { assembleDocument, emptyDocument, readDocumentText } from './base'

export const HTML_PARSER_ID = 'html'
export const HTML_PARSER_VERSION = '1'

const EXTENSIONS: readonly string[] = ['.html', '.htm']

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number.parseInt(code, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))
}

function stripTags(html: string): string {
  return decodeHtmlEntities(html.replace(/<[^>]+>/g, ''))
    .replace(/\s+/g, ' ')
    .trim()
}

interface ExtractedHtml {
  readonly title: string | undefined
  readonly blocks: readonly Block[]
}

export function parseHtml(html: string): ExtractedHtml {
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)
  const title = titleMatch !== null ? stripTags(titleMatch[1]!) : undefined

  let cleanHtml = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, '')
    .replace(/<svg[^>]*>[\s\S]*?<\/svg>/gi, '')

  const bodyMatch = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(cleanHtml)
  if (bodyMatch !== null) {
    cleanHtml = bodyMatch[1]!
  }

  const blocks: Block[] = []
  const blockRegex = /<(h[1-6]|p|ul|ol|pre|table|blockquote)[^>]*>([\s\S]*?)<\/\1>/gi

  let match: RegExpExecArray | null
  while ((match = blockRegex.exec(cleanHtml)) !== null) {
    const tag = match[1]!.toLowerCase()
    const inner = match[2]!

    if (tag.startsWith('h')) {
      const level = Number.parseInt(tag.slice(1), 10)
      const text = stripTags(inner)
      if (text !== '') {
        blocks.push({ kind: 'heading', level, text })
      }
    } else if (tag === 'p' || tag === 'blockquote') {
      const text = stripTags(inner)
      if (text !== '') {
        blocks.push({ kind: 'paragraph', text })
      }
    } else if (tag === 'ul' || tag === 'ol') {
      const itemRegex = /<li[^>]*>([\s\S]*?)<\/li>/gi
      const items: string[] = []
      let itemMatch: RegExpExecArray | null
      while ((itemMatch = itemRegex.exec(inner)) !== null) {
        const itemText = stripTags(itemMatch[1]!)
        if (itemText !== '') items.push(itemText)
      }
      if (items.length > 0) {
        blocks.push({ kind: 'list', text: items.join('\n') })
      }
    } else if (tag === 'pre') {
      const codeOnly = inner.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '$1')
      const codeText = decodeHtmlEntities(codeOnly).trim()
      if (codeText !== '') {
        blocks.push({ kind: 'code', text: codeText })
      }
    } else if (tag === 'table') {
      const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi
      const tableLines: string[] = []
      let rowMatch: RegExpExecArray | null

      while ((rowMatch = rowRegex.exec(inner)) !== null) {
        const rowInner = rowMatch[1]!
        const cellRegex = /<(?:td|th)[^>]*>([\s\S]*?)<\/(?:td|th)>/gi
        const cells: string[] = []
        let cellMatch: RegExpExecArray | null
        while ((cellMatch = cellRegex.exec(rowInner)) !== null) {
          cells.push(stripTags(cellMatch[1]!))
        }
        if (cells.length > 0) {
          tableLines.push(`| ${cells.join(' | ')} |`)
        }
      }

      if (tableLines.length > 0) {
        blocks.push({ kind: 'table', text: tableLines.join('\n') })
      }
    }
  }

  if (blocks.length === 0) {
    const plain = stripTags(cleanHtml)
    if (plain !== '') {
      blocks.push({ kind: 'paragraph', text: plain })
    }
  }

  return { title, blocks }
}

export function createHtmlParser(): VersionedParser {
  return {
    id: HTML_PARSER_ID,
    version: HTML_PARSER_VERSION,
    extensions: EXTENSIONS,
    supports: (extension: string) => EXTENSIONS.includes(extension.toLowerCase()),
    parse: async (input: ParseInput): Promise<ParsedDocument> => {
      const text = await readDocumentText(input)
      const { title, blocks } = parseHtml(text)
      if (blocks.length === 0) emptyDocument()
      return assembleDocument(input, blocks, title)
    },
  }
}
