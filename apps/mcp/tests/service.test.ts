import { describe, expect, it } from 'vitest'

import { defaultConfig } from '@twigraph/shared'
import type {
  ChunkRecord,
  DocumentRecord,
  FolderRecord,
  FolderRegistry,
  IndexManifest,
  IndexStore,
} from '@twigraph/shared'

import { createMcpSearchService } from '../src/service'

const folder: FolderRecord = {
  id: 'folder-one',
  path: 'C:\\synthetic\\notes',
  addedAtMs: 1,
  lastIndexedAtMs: 2,
  documentCount: 1,
  chunkCount: 1,
}

const document: DocumentRecord = {
  id: 'document-one',
  folderId: folder.id,
  filename: 'policy.md',
  relativePath: 'policy.md',
  absolutePath: 'C:\\synthetic\\notes\\policy.md',
  extension: '.md',
  sizeBytes: 80,
  modifiedAtMs: 1,
  contentHash: 'abc',
  chunkCount: 1,
  status: 'indexed',
}

const chunk: ChunkRecord = {
  id: 'document-one:0',
  documentId: document.id,
  ordinal: 0,
  text: 'A termination decision must cite the applicable policy and supporting evidence.',
  headingPath: ['Employment', 'Termination'],
  charStart: 0,
  charEnd: 80,
}

const manifest: IndexManifest = {
  folderId: folder.id,
  folderPath: folder.path,
  builtAtMs: 2,
  parserVersions: { markdown: '1' },
  documentCount: 1,
  chunkCount: 1,
  failedCount: 0,
  embedding: null,
}

function registry(): FolderRegistry {
  return {
    list: async () => [folder],
    find: async (id) => (id === folder.id ? folder : null),
    add: async () => folder,
    update: async () => folder,
    remove: async () => undefined,
  }
}

function store(): IndexStore {
  return {
    readManifest: async (id) => (id === folder.id ? manifest : null),
    readDocuments: async (id) => (id === folder.id ? [document] : []),
    readChunks: async (id) => (id === folder.id ? [chunk] : []),
    replaceIndex: async () => manifest,
    remove: async () => undefined,
    sizeBytes: async (id) => (id === folder.id ? 512 : 0),
  }
}

describe('MCP search service', () => {
  it('returns grounded search hits from indexed chunks', async () => {
    const service = createMcpSearchService({
      registry: registry(),
      store: store(),
      retrieval: defaultConfig().retrieval,
      now: () => 10,
    })

    const result = await service.search({ query: 'termination policy', topK: 3 })

    expect(result.confident).toBe(true)
    expect(result.hits).toEqual([
      expect.objectContaining({
        chunkId: chunk.id,
        absolutePath: document.absolutePath,
        text: chunk.text,
        headingPath: chunk.headingPath,
      }),
    ])
  })

  it('rejects an unknown folder filter instead of silently searching elsewhere', async () => {
    const service = createMcpSearchService({
      registry: registry(),
      store: store(),
      retrieval: defaultConfig().retrieval,
    })

    await expect(service.search({ query: 'termination', folderIds: ['missing'] })).rejects.toThrow(
      'Unknown folder id',
    )
  })

  it('reports folder index status without reading source files', async () => {
    const service = createMcpSearchService({
      registry: registry(),
      store: store(),
      retrieval: defaultConfig().retrieval,
    })

    await expect(service.status()).resolves.toEqual({
      folders: [{ ...folder, indexed: true, manifest, sizeBytes: 512 }],
    })
  })

  it('returns one indexed chunk with its source metadata', async () => {
    const service = createMcpSearchService({
      registry: registry(),
      store: store(),
      retrieval: defaultConfig().retrieval,
    })

    await expect(service.getChunk({ chunkId: chunk.id })).resolves.toEqual({
      chunk,
      document,
      folder,
    })
  })
})
