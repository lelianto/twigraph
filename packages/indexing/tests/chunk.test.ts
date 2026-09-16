import { describe, expect, it } from 'vitest'

import type { Block, ParsedDocument } from '@mulat/shared'

import { chunkDocument } from '../src/chunk'
import type { ChunkingOptions } from '../src/chunk'

const TIGHT: ChunkingOptions = { targetTokens: 42, overlapRatio: 0.12 }
const NO_OVERLAP: ChunkingOptions = { targetTokens: 42, overlapRatio: 0 }

function documentOf(blocks: readonly Block[]): ParsedDocument {
  return {
    metadata: {
      filename: 'doc.md',
      relativePath: 'doc.md',
      absolutePath: '/nowhere/doc.md',
      extension: '.md',
      sizeBytes: 0,
      modifiedAtMs: 0,
      contentHash: 'x',
      parseWarnings: [],
    },
    blocks,
  }
}

const textOf = (blocks: readonly Block[]): string => blocks.map((block) => block.text).join('\n\n')

/** A paragraph of whole sentences, long enough to need several chunks at TIGHT. */
const sentence = (index: number): string => `Sentence number ${index} records something here.`
const paragraph = (count: number): string =>
  Array.from({ length: count }, (_, index) => sentence(index + 1)).join(' ')

const TWO_SECTIONS: readonly Block[] = [
  { kind: 'heading', level: 1, text: 'Alpha' },
  { kind: 'paragraph', text: paragraph(4) },
  { kind: 'heading', level: 2, text: 'Beta' },
  { kind: 'paragraph', text: paragraph(4) },
]

const LONG_SECTION: readonly Block[] = [
  { kind: 'heading', level: 1, text: 'Only section' },
  { kind: 'paragraph', text: paragraph(24) },
]

describe('chunking a document', () => {
  it('produces byte-identical chunks on a second run', () => {
    const first = chunkDocument(documentOf(TWO_SECTIONS), 'doc', TIGHT)
    const second = chunkDocument(documentOf(TWO_SECTIONS), 'doc', TIGHT)
    expect(JSON.stringify(second)).toBe(JSON.stringify(first))
  })

  it('returns nothing for a document with no blocks', () => {
    expect(chunkDocument(documentOf([]), 'doc', TIGHT)).toEqual([])
  })

  it('returns nothing when every block is blank', () => {
    expect(chunkDocument(documentOf([{ kind: 'paragraph', text: '   ' }]), 'doc', TIGHT)).toEqual(
      [],
    )
  })

  it('numbers the chunks from zero and derives their ids', () => {
    const chunks = chunkDocument(documentOf(LONG_SECTION), 'doc', TIGHT)
    expect(chunks.length).toBeGreaterThan(2)
    expect(chunks.map((chunk) => chunk.ordinal)).toEqual(chunks.map((_, index) => index))
    expect(chunks.map((chunk) => chunk.id)).toEqual(chunks.map((chunk) => `doc:${chunk.ordinal}`))
    expect(chunks.every((chunk) => chunk.documentId === 'doc')).toBe(true)
  })

  it('keeps the chunk text exactly equal to its slice of the document', () => {
    const blocks = LONG_SECTION
    const text = textOf(blocks)
    const chunks = chunkDocument(documentOf(blocks), 'doc', TIGHT)

    for (const chunk of chunks) {
      expect(chunk.text).toBe(text.slice(chunk.charStart, chunk.charEnd))
    }
  })

  it('never lets a chunk contain text from a section it does not cite', () => {
    const blocks = TWO_SECTIONS
    const text = textOf(blocks)
    const betaAt = text.indexOf('Beta')
    const chunks = chunkDocument(documentOf(blocks), 'doc', TIGHT)

    for (const chunk of chunks) {
      if (chunk.charEnd <= betaAt) {
        expect(chunk.text).not.toContain('Beta')
        expect(chunk.headingPath).toEqual(['Alpha'])
      }
    }
  })

  it('carries the heading trail of the section a chunk belongs to', () => {
    const chunks = chunkDocument(documentOf(TWO_SECTIONS), 'doc', TIGHT)
    const trails = new Set(chunks.map((chunk) => chunk.headingPath.join(' > ')))

    expect([...trails].sort()).toEqual(['Alpha', 'Alpha > Beta'])
  })

  it('keeps consecutive headings together instead of emitting an empty chunk', () => {
    const blocks: readonly Block[] = [
      { kind: 'heading', level: 1, text: 'One' },
      { kind: 'heading', level: 2, text: 'Two' },
      { kind: 'heading', level: 3, text: 'Three' },
    ]
    const chunks = chunkDocument(documentOf(blocks), 'doc', TIGHT)

    expect(chunks).toHaveLength(1)
    expect(chunks[0]?.text).toBe('One\n\nTwo\n\nThree')
    expect(chunks[0]?.headingPath).toEqual(['One', 'Two', 'Three'])
  })

  it('stays within the target when overlap is off', () => {
    const chunks = chunkDocument(documentOf(LONG_SECTION), 'doc', NO_OVERLAP)
    const maxChars = NO_OVERLAP.targetTokens * 4

    for (const chunk of chunks) {
      expect(chunk.charEnd - chunk.charStart).toBeLessThanOrEqual(maxChars)
    }
  })

  it('splits a single oversized paragraph into several chunks', () => {
    const blocks: readonly Block[] = [{ kind: 'paragraph', text: paragraph(24) }]
    const chunks = chunkDocument(documentOf(blocks), 'doc', NO_OVERLAP)

    expect(chunks.length).toBeGreaterThan(3)
    expect(chunks.reduce((total, chunk) => total + chunk.text.length, 0)).toBeGreaterThan(
      paragraph(24).length * 0.9,
    )
  })

  it('starts every chunk after the first at a sentence boundary', () => {
    const blocks = LONG_SECTION
    const text = textOf(blocks)
    const chunks = chunkDocument(documentOf(blocks), 'doc', TIGHT)

    for (const chunk of chunks.slice(1)) {
      expect(chunk.charStart).toBeGreaterThan(0)
      expect(/[.!?][ ")']*\s$/.test(text.slice(0, chunk.charStart))).toBe(true)
    }
  })

  it('overlaps each chunk with the one before it, without swallowing it', () => {
    const chunks = chunkDocument(documentOf(LONG_SECTION), 'doc', TIGHT)
    expect(chunks.length).toBeGreaterThan(2)

    for (let index = 1; index < chunks.length; index += 1) {
      const previous = chunks[index - 1]
      const chunk = chunks[index]
      if (previous === undefined || chunk === undefined) continue

      expect(chunk.charStart).toBeLessThan(previous.charEnd)
      expect(chunk.charStart).toBeGreaterThan(previous.charStart)
    }
  })

  it('does not overlap at all when the ratio is zero', () => {
    const chunks = chunkDocument(documentOf(LONG_SECTION), 'doc', NO_OVERLAP)
    for (let index = 1; index < chunks.length; index += 1) {
      expect(chunks[index]?.charStart).toBe(chunks[index - 1]?.charEnd)
    }
  })

  it('carries page numbers through from the blocks', () => {
    const blocks: readonly Block[] = [
      { kind: 'paragraph', text: paragraph(1), page: 3 },
      { kind: 'paragraph', text: paragraph(1), page: 7 },
    ]
    const chunks = chunkDocument(documentOf(blocks), 'doc', TIGHT)

    expect(chunks).toHaveLength(1)
    expect(chunks[0]?.page).toBe(3)
    expect(chunks[0]?.pageEnd).toBe(7)
  })

  it('leaves the page off a format that has none', () => {
    const chunks = chunkDocument(documentOf(TWO_SECTIONS), 'doc', TIGHT)
    expect(chunks.every((chunk) => chunk.page === undefined)).toBe(true)
    expect(chunks.every((chunk) => chunk.pageEnd === undefined)).toBe(true)
    expect(chunks.every((chunk) => !('page' in chunk))).toBe(true)
  })
})
