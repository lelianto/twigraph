import { describe, expect, it } from 'vitest'

import type { ChunkRecord, RetrievalSnapshot, SearchHit } from '@twigraph/shared'

import { createExtractiveAnswerEngine } from '../src/extractive'

const sampleChunk1: ChunkRecord = {
  id: 'doc1:0',
  documentId: 'doc1',
  ordinal: 0,
  text: 'Introduction to ranking algorithms. Reciprocal rank fusion combines rank lists with 1 / (k + rank). The constant k is 60.',
  headingPath: ['Retrieval', 'Fusion'],
  charStart: 0,
  charEnd: 124,
}

const sampleHit1: SearchHit = {
  chunkId: 'doc1:0',
  documentId: 'doc1',
  filename: 'retrieval.md',
  absolutePath: '/docs/retrieval.md',
  headingPath: ['Retrieval', 'Fusion'],
  excerpt: 'Reciprocal rank fusion combines rank lists…',
  text: sampleChunk1.text,
  score: 0.85,
  ranks: { bm25: 0 },
}

const sampleChunk2: ChunkRecord = {
  id: 'doc2:0',
  documentId: 'doc2',
  ordinal: 0,
  text: 'Reciprocal rank fusion operates without summing raw scores.',
  headingPath: ['Algorithms'],
  charStart: 0,
  charEnd: 59,
}

const sampleHit2: SearchHit = {
  chunkId: 'doc2:0',
  documentId: 'doc2',
  filename: 'algorithms.md',
  absolutePath: '/docs/algorithms.md',
  headingPath: ['Algorithms'],
  excerpt: 'Reciprocal rank fusion operates…',
  text: sampleChunk2.text,
  score: 0.75,
  ranks: { bm25: 1 },
}

describe('the extractive answer engine', () => {
  it('identifies itself as extractive', () => {
    const engine = createExtractiveAnswerEngine()
    expect(engine.id).toBe('extractive')
    expect(engine.label).toContain('Extractive')
  })

  it('is always available locally', async () => {
    const engine = createExtractiveAnswerEngine()
    expect(await engine.isAvailable()).toBe(true)
  })

  it('returns insufficient answer when snapshot is not confident', async () => {
    const engine = createExtractiveAnswerEngine()
    const snapshot: RetrievalSnapshot = {
      hits: [sampleHit1],
      chunksById: new Map([[sampleChunk1.id, sampleChunk1]]),
      vectorsByChunkId: new Map(),
      confident: false,
    }

    const answer = await engine.answer('reciprocal rank fusion', snapshot)

    expect(answer.status).toBe('insufficient')
    expect(answer.text).toBe('No reliable answer found.')
    expect(answer.citations).toEqual([])
    expect(answer.passages).toEqual([])
    expect(answer.sources).toEqual([sampleHit1])
  })

  it('produces a grounded answer selecting the best scoring sentence across multiple hits', async () => {
    const engine = createExtractiveAnswerEngine()
    const snapshot: RetrievalSnapshot = {
      hits: [sampleHit1, sampleHit2],
      chunksById: new Map([
        [sampleChunk1.id, sampleChunk1],
        [sampleChunk2.id, sampleChunk2],
      ]),
      vectorsByChunkId: new Map(),
      confident: true,
    }

    const answer = await engine.answer('reciprocal rank fusion', snapshot)

    expect(answer.status).toBe('answered')
    expect(answer.citations).toHaveLength(2)
    expect(answer.citations[0]?.marker).toBe(1)
    expect(answer.citations[0]?.chunkId).toBe('doc1:0')
    expect(answer.citations[1]?.marker).toBe(2)
    expect(answer.citations[1]?.chunkId).toBe('doc2:0')
    expect(answer.passages).toHaveLength(2)
    expect(answer.text).toContain('[1]')
    expect(answer.text).toContain('[2]')
    // Verifies that the second sentence of chunk 1 was picked because it had more matching terms
    expect(answer.passages[0]?.text).toBe(
      'Reciprocal rank fusion combines rank lists with 1 / (k + rank).',
    )
  })

  it('handles hits with empty text or no sentences gracefully', async () => {
    const engine = createExtractiveAnswerEngine()
    const emptyHit: SearchHit = {
      ...sampleHit1,
      text: '   ',
    }
    const snapshot: RetrievalSnapshot = {
      hits: [emptyHit],
      chunksById: new Map([[emptyHit.chunkId, { ...sampleChunk1, text: '   ' }]]),
      vectorsByChunkId: new Map(),
      confident: true,
    }

    const answer = await engine.answer('reciprocal rank fusion', snapshot)
    expect(answer.status).toBe('insufficient')
    expect(answer.text).toBe('No reliable answer found.')
  })
})
