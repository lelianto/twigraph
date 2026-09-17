import type { Block, ParsedDocument, ParseInput } from '@twigraph/shared'

import type { VersionedParser } from '../parser'
import { assembleDocument, emptyDocument, readDocumentText } from './base'

export const MARKDOWN_PARSER_ID = 'markdown'
export const MARKDOWN_PARSER_VERSION = '1'

const EXTENSIONS: readonly string[] = ['.md']

/** `#{1,6}` followed by whitespace. Seven hashes, or `#NoSpace`, is an ordinary line. */
const HEADING = /^(#{1,6})[ \t]+(.*?)[ \t]*#*[ \t]*$/

/** `-`, `*`, `+`, `1.` or `1)`, at any indentation, so a nested item is an item. */
const LIST_ITEM = /^[ \t]*(?:[-*+]|\d+[.)])[ \t]+(.*)$/

const FENCE = /^[ \t]*```/

/**
 * Markdown, reduced to blocks.
 *
 * Presentation markup is stripped because it carries no meaning the user is looking for —
 * a bullet glyph is not a word. Code blocks and tables are kept whole because their
 * contents do carry meaning, and their layout is part of it.
 *
 * Inline markup is deliberately not parsed: `**bold**` stays as written. Unwrapping it
 * would mean the text in a citation no longer matches the text in the file, and an excerpt
 * the user cannot find in their own document is worse than one with asterisks in it.
 */
function blocksOf(text: string): readonly Block[] {
  const blocks: Block[] = []
  let paragraph: string[] = []
  let list: string[] = []
  let table: string[] = []
  let code: string[] | null = null

  const flushParagraph = (): void => {
    if (paragraph.length === 0) return
    blocks.push({ kind: 'paragraph', text: paragraph.join('\n') })
    paragraph = []
  }
  const flushList = (): void => {
    if (list.length === 0) return
    blocks.push({ kind: 'list', text: list.join('\n') })
    list = []
  }
  const flushTable = (): void => {
    if (table.length === 0) return
    blocks.push({ kind: 'table', text: table.join('\n') })
    table = []
  }
  const flushAll = (): void => {
    flushParagraph()
    flushList()
    flushTable()
  }

  // A file's closing newline is a terminator, not a blank line. Splitting without this
  // would hand every document one extra empty line, which an unterminated fence would
  // then keep as part of its code.
  const lines = text.endsWith('\n') ? text.slice(0, -1).split('\n') : text.split('\n')

  for (const line of lines) {
    if (code !== null) {
      if (FENCE.test(line)) {
        if (code.length > 0) blocks.push({ kind: 'code', text: code.join('\n') })
        code = null
      } else {
        code.push(line)
      }
      continue
    }

    if (FENCE.test(line)) {
      flushAll()
      code = []
      continue
    }

    if (line.trim() === '') {
      flushAll()
      continue
    }

    const heading = HEADING.exec(line)
    if (heading !== null) {
      flushAll()
      const headingText = (heading[2] ?? '').trim()
      if (headingText !== '') {
        blocks.push({ kind: 'heading', level: (heading[1] ?? '').length, text: headingText })
      }
      continue
    }

    if (line.trimStart().startsWith('|')) {
      flushParagraph()
      flushList()
      table.push(line.trim())
      continue
    }

    const item = LIST_ITEM.exec(line)
    if (item !== null) {
      flushParagraph()
      flushTable()
      const itemText = (item[1] ?? '').trim()
      if (itemText !== '') list.push(itemText)
      continue
    }

    flushList()
    flushTable()
    paragraph.push(line.trim())
  }

  // An unterminated fence runs to the end of the file rather than swallowing the document.
  if (code !== null && code.length > 0) blocks.push({ kind: 'code', text: code.join('\n') })

  flushAll()
  return blocks
}

function titleOf(blocks: readonly Block[]): string | undefined {
  const heading = blocks.find((block) => block.kind === 'heading')
  const first = blocks.find((block) => block.text.trim() !== '')
  const candidate = heading ?? first
  if (candidate === undefined) return undefined
  return candidate.text.split('\n')[0]?.trim()
}

export function createMarkdownParser(): VersionedParser {
  return {
    id: MARKDOWN_PARSER_ID,
    version: MARKDOWN_PARSER_VERSION,
    extensions: EXTENSIONS,
    supports: (extension: string) => EXTENSIONS.includes(extension.toLowerCase()),
    parse: async (input: ParseInput): Promise<ParsedDocument> => {
      const text = await readDocumentText(input)
      const blocks = blocksOf(text)
      if (blocks.length === 0) emptyDocument()
      return assembleDocument(input, blocks, titleOf(blocks))
    },
  }
}
