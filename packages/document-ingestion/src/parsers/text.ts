import type { Block, ParsedDocument, ParseInput } from '@twigraph/shared'

import type { VersionedParser } from '../parser'
import { assembleDocument, emptyDocument, firstNonBlankLine, readDocumentText } from './base'

export const TEXT_PARSER_ID = 'text'
export const TEXT_PARSER_VERSION = '1'

const EXTENSIONS: readonly string[] = ['.txt']

function blocksOf(text: string): readonly Block[] {
  return text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph !== '')
    .map((paragraph) => ({ kind: 'paragraph' as const, text: paragraph }))
}

/**
 * Plain text: a blank line ends a paragraph, and a wrapped line stays inside one.
 *
 * There is no structure to recover here, so a plain text document contributes paragraphs
 * and nothing else. Every paragraph becomes a block, which is what keeps citations at
 * least paragraph-accurate in a format that has no pages and no headings.
 */
export function createTextParser(): VersionedParser {
  return {
    id: TEXT_PARSER_ID,
    version: TEXT_PARSER_VERSION,
    extensions: EXTENSIONS,
    supports: (extension: string) => EXTENSIONS.includes(extension.toLowerCase()),
    parse: async (input: ParseInput): Promise<ParsedDocument> => {
      const text = await readDocumentText(input)
      const blocks = blocksOf(text)
      if (blocks.length === 0) emptyDocument()
      return assembleDocument(input, blocks, firstNonBlankLine(text))
    },
  }
}
