import { describe, expect, it } from 'vitest'

import { buildLexicalIndex, searchLexical } from '../src/bm25'
import type { IndexableChunk } from '../src/bm25'

const OPTIONS = { k1: 1.2, b: 0.75, topK: 8 }

const CORPUS: readonly IndexableChunk[] = [
  { id: 'a', text: 'the reciprocal rank fusion constant is sixty' },
  { id: 'b', text: 'bm25 ranks documents with k1 and b' },
  { id: 'c', text: 'embeddings are stored as unit vectors' },
]

const ids = (chunks: readonly { chunkId: string }[]): readonly string[] =>
  chunks.map((chunk) => chunk.chunkId)

describe('ranking with BM25', () => {
  it('puts the chunk holding the term first', () => {
    const index = buildLexicalIndex(CORPUS)

    expect(ids(searchLexical(index, 'reciprocal', OPTIONS))[0]).toBe('a')
    expect(ids(searchLexical(index, 'bm25', OPTIONS))[0]).toBe('b')
    expect(ids(searchLexical(index, 'vectors', OPTIONS))[0]).toBe('c')
  })

  it('ranks a chunk matching more query terms above one matching fewer', () => {
    const index = buildLexicalIndex(CORPUS)
    const hits = searchLexical(index, 'reciprocal fusion stored', OPTIONS)

    expect(ids(hits)[0]).toBe('a')
    expect(hits[0]?.score).toBeGreaterThan(hits[1]?.score ?? 0)
  })

  it('ranks the same term twice above the same term once', () => {
    const index = buildLexicalIndex([
      { id: 'twice', text: 'kappa kappa' },
      { id: 'once', text: 'kappa' },
    ])

    expect(ids(searchLexical(index, 'kappa', OPTIONS))).toEqual(['twice', 'once'])
  })

  it('ranks the shorter of two equal matches higher', () => {
    const index = buildLexicalIndex([
      { id: 'long', text: 'kappa filler filler filler filler' },
      { id: 'short', text: 'kappa' },
    ])

    expect(ids(searchLexical(index, 'kappa', OPTIONS))).toEqual(['short', 'long'])
  })

  it('breaks a tie by chunk id, so two runs always agree', () => {
    const index = buildLexicalIndex([
      { id: 'z', text: 'identical text' },
      { id: 'a', text: 'identical text' },
    ])

    expect(ids(searchLexical(index, 'identical', OPTIONS))).toEqual(['a', 'z'])
  })

  it('normalises every score into zero to one', () => {
    const index = buildLexicalIndex(CORPUS)
    for (const hit of searchLexical(index, 'reciprocal fusion sixty', OPTIONS)) {
      expect(hit.score).toBeGreaterThan(0)
      expect(hit.score).toBeLessThanOrEqual(1)
    }
  })

  it('scores a partial match below a complete one', () => {
    const index = buildLexicalIndex(CORPUS)
    const partial = searchLexical(index, 'reciprocal absent absent', OPTIONS)
    const complete = searchLexical(index, 'reciprocal rank fusion', OPTIONS)

    expect(partial[0]?.score).toBeLessThan(complete[0]?.score ?? 0)
  })

  it('numbers the rank list from zero', () => {
    const index = buildLexicalIndex(CORPUS)
    const hits = searchLexical(index, 'the', OPTIONS)

    expect(hits.map((hit) => hit.rank)).toEqual(hits.map((_, position) => position))
  })

  it('returns nothing when no chunk holds the term', () => {
    const index = buildLexicalIndex(CORPUS)
    expect(searchLexical(index, 'nonexistentterm', OPTIONS)).toEqual([])
  })

  it('returns nothing for an empty query or an empty index', () => {
    expect(searchLexical(buildLexicalIndex(CORPUS), '   ', OPTIONS)).toEqual([])
    expect(searchLexical(buildLexicalIndex([]), 'anything', OPTIONS)).toEqual([])
  })

  it('honours topK', () => {
    const index = buildLexicalIndex(CORPUS)
    expect(searchLexical(index, 'the', { ...OPTIONS, topK: 1 })).toHaveLength(1)
  })

  it('builds the same statistics twice for the same corpus', () => {
    const first = buildLexicalIndex(CORPUS)
    const second = buildLexicalIndex(CORPUS)

    expect(second.chunkIds).toEqual(first.chunkIds)
    expect(second.lengths).toEqual(first.lengths)
    expect(second.averageLength).toBe(first.averageLength)
    expect([...second.postings.keys()].sort()).toEqual([...first.postings.keys()].sort())
  })
})
