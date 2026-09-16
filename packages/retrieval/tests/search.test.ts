import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { generateFixtures } from '../../../fixtures/generate.mjs'
import { buildIndex, createIndexStore } from '@mulat/indexing'
import { MulatError } from '@mulat/shared'
import type { ChunkRecord, DocumentRecord, RetrievalConfig } from '@mulat/shared'

import { createRetriever, meetsConfidence } from '../src/search'
import type { SearchCorpus } from '../src/search'

const CONFIG: RetrievalConfig = {
  topK: 8,
  minScore: 0.35,
  rrfK: 60,
  bm25: { k1: 1.2, b: 0.75 },
}

const FOLDER_ID = 'aaaaaaaabbbbbbbb'

function chunkOf(
  id: string,
  documentId: string,
  text: string,
  extra: Partial<ChunkRecord> = {},
): ChunkRecord {
  return {
    id,
    documentId,
    ordinal: 0,
    text,
    headingPath: ['Storage'],
    charStart: 0,
    charEnd: text.length,
    ...extra,
  }
}

function documentOf(
  id: string,
  filename: string,
  extra: Partial<DocumentRecord> = {},
): DocumentRecord {
  return {
    id,
    folderId: FOLDER_ID,
    filename,
    relativePath: filename,
    absolutePath: `/nowhere/${filename}`,
    extension: '.md',
    sizeBytes: 1,
    modifiedAtMs: 0,
    contentHash: 'hash',
    chunkCount: 1,
    status: 'indexed',
    ...extra,
  }
}

const CORPUS: SearchCorpus = {
  documents: [documentOf('d1', 'storage.md'), documentOf('d2', 'retrieval.md')],
  chunks: [
    chunkOf('c1', 'd1', 'A re-index builds a staging directory and swaps it in.', {
      page: 4,
      pageEnd: 6,
    }),
    chunkOf('c2', 'd2', 'BM25 is the floor of the system and needs no model download.'),
  ],
}

function retrieverFor(corpus: SearchCorpus, overrides: Partial<RetrievalConfig> = {}) {
  let ticks = 0
  const retriever = createRetriever(async () => corpus, {
    config: { ...CONFIG, ...overrides },
    now: () => (ticks += 5),
  })
  return retriever
}

describe('searching', () => {
  it('refuses an empty query instead of returning everything', async () => {
    const retriever = retrieverFor(CORPUS)
    await expect(retriever.search('   ')).rejects.toBeInstanceOf(MulatError)
    await expect(retriever.search('')).rejects.toMatchObject({ code: 'QUERY_EMPTY' })
  })

  it('reports the mode it actually used', async () => {
    const result = await retrieverFor(CORPUS).search('staging directory')
    expect(result.mode).toBe('lexical')
    expect(result.query).toBe('staging directory')
  })

  it('carries everything a citation needs', async () => {
    const result = await retrieverFor(CORPUS).search('staging directory')
    const hit = result.hits[0]

    expect(hit).toMatchObject({
      chunkId: 'c1',
      documentId: 'd1',
      filename: 'storage.md',
      absolutePath: '/nowhere/storage.md',
      headingPath: ['Storage'],
      page: 4,
      pageEnd: 6,
    })
  })

  it('centres the excerpt on the match rather than on the start of the chunk', async () => {
    const long = `${'padding words '.repeat(40)}the staging directory is swapped in ${'more padding '.repeat(40)}`
    const corpus: SearchCorpus = {
      documents: [documentOf('d1', 'long.md')],
      chunks: [chunkOf('c1', 'd1', long)],
    }

    const hit = (await retrieverFor(corpus).search('staging')).hits[0]
    expect(hit?.excerpt).toContain('staging')
    expect(hit?.excerpt.length).toBeLessThanOrEqual(250)
    expect(hit?.excerpt.startsWith('…')).toBe(true)
    expect(hit?.excerpt.endsWith('…')).toBe(true)
  })

  it('leaves a short chunk whole', async () => {
    const hit = (await retrieverFor(CORPUS).search('staging')).hits[0]
    expect(hit?.excerpt).toBe('A re-index builds a staging directory and swaps it in.')
  })

  it('numbers the bm25 rank list from zero', async () => {
    const result = await retrieverFor(CORPUS).search('and')
    expect(result.hits.map((hit) => hit.ranks.bm25)).toEqual(result.hits.map((_, index) => index))
  })

  it('honours a topK given for one search, over the configured one', async () => {
    const retriever = retrieverFor(CORPUS, { topK: 1 })

    // 'and' is the one term both fixtures share, so the rank list holds two chunks.
    expect((await retriever.search('and', { topK: 5 })).hits).toHaveLength(2)
    expect((await retriever.search('and')).hits).toHaveLength(1)
  })

  it('reports how long it took, from the injected clock', async () => {
    const result = await retrieverFor(CORPUS).search('staging')
    expect(result.tookMs).toBe(5)
  })

  it('returns the same result twice for the same query', async () => {
    const retriever = retrieverFor(CORPUS)
    expect(await retriever.search('the')).toEqual(await retriever.search('the'))
  })

  it('drops a chunk whose document is not in the index, because it could not be cited', async () => {
    const corpus: SearchCorpus = {
      documents: [],
      chunks: [chunkOf('c1', 'missing', 'staging directory')],
    }

    expect((await retrieverFor(corpus).search('staging')).hits).toEqual([])
  })

  it('returns nothing when the index is empty', async () => {
    const empty: SearchCorpus = { documents: [], chunks: [] }
    const result = await retrieverFor(empty).search('anything')

    expect(result.hits).toEqual([])
    expect(meetsConfidence(result, 0.35)).toBe(false)
  })
})

describe('the confidence gate', () => {
  it('passes a match that accounts for every term in the query', async () => {
    const result = await retrieverFor(CORPUS).search('staging directory builds')
    expect(result.hits[0]?.filename).toBe('storage.md')
    expect(meetsConfidence(result, 0.35)).toBe(true)
  })

  it('refuses a weak one, so nothing is guessed from it', async () => {
    const result = await retrieverFor(CORPUS).search('staging unrelatedterm anotherterm')
    expect(meetsConfidence(result, 0.9)).toBe(false)
  })
})

describe('searching a real index built from the fixtures', () => {
  let root = ''
  let dataDir = ''

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'mulat-search-src-'))
    dataDir = await mkdtemp(join(tmpdir(), 'mulat-search-data-'))
    await generateFixtures(root)
    const data = createIndexStore({ dataDir })
    await buildIndex(data, {
      folderId: FOLDER_ID,
      folderPath: root,
      nowMs: 1_700_000_000_000,
      chunking: { targetTokens: 900, overlapRatio: 0.12 },
    })
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
    await rm(dataDir, { recursive: true, force: true })
  })

  it('finds the document that actually discusses the query', async () => {
    const data = createIndexStore({ dataDir })
    const retriever = createRetriever(
      async () => ({
        chunks: await data.store.readChunks(FOLDER_ID),
        documents: await data.store.readDocuments(FOLDER_ID),
      }),
      { config: CONFIG },
    )

    const result = await retriever.search('reciprocal rank fusion')
    expect(result.hits[0]?.filename).toBe('retrieval.md')
    expect(result.hits[0]?.headingPath).toContain('Fusion')
    expect(meetsConfidence(result, CONFIG.minScore)).toBe(true)
  })

  it('never cites a file that failed to parse', async () => {
    const data = createIndexStore({ dataDir })
    const chunks = await data.store.readChunks(FOLDER_ID)
    const documents = await data.store.readDocuments(FOLDER_ID)
    const failed = new Set(
      documents.filter((document) => document.status === 'failed').map((document) => document.id),
    )

    expect(chunks.some((chunk) => failed.has(chunk.documentId))).toBe(false)
  })

  it('refuses a query the index knows nothing about', async () => {
    const data = createIndexStore({ dataDir })
    const retriever = createRetriever(
      async () => ({
        chunks: await data.store.readChunks(FOLDER_ID),
        documents: await data.store.readDocuments(FOLDER_ID),
      }),
      { config: CONFIG },
    )

    const result = await retriever.search('zzzznotpresent')
    expect(result.hits).toEqual([])
    expect(meetsConfidence(result, CONFIG.minScore)).toBe(false)
  })
})
