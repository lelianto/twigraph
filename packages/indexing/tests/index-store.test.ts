import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { ChunkRecord, DocumentRecord, IndexPayload, IndexManifest } from '@mulat/shared'

import { createIndexStore } from '../src/index-store'
import type { DataStore } from '../src/index-store'
import { indexDirectory, previousDirectory, stagingDirectory } from '../src/layout'

const FOLDER_ID = 'aaaaaaaabbbbbbbb'

let dataDir = ''
let data: DataStore

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'mulat-index-'))
  data = createIndexStore({ dataDir })
})

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true })
})

function documentOf(index: number, status: 'indexed' | 'failed' = 'indexed'): DocumentRecord {
  return {
    id: `doc-${index}`,
    folderId: FOLDER_ID,
    filename: `doc-${index}.md`,
    relativePath: `doc-${index}.md`,
    absolutePath: `/nowhere/doc-${index}.md`,
    extension: '.md',
    sizeBytes: 10 + index,
    modifiedAtMs: 1_700_000_000_000 + index,
    contentHash: `hash-${index}`,
    chunkCount: status === 'indexed' ? 1 : 0,
    status,
    ...(status === 'failed' ? { errorCode: 'PARSE_FAILED' as const, errorMessage: 'nope' } : {}),
  }
}

function chunkOf(index: number): ChunkRecord {
  return {
    id: `doc-${index}:0`,
    documentId: `doc-${index}`,
    ordinal: 0,
    text: `chunk number ${index}`,
    headingPath: ['Top'],
    charStart: 0,
    charEnd: 16,
  }
}

function manifestOf(overrides: Partial<IndexManifest> = {}): IndexManifest {
  return {
    folderId: FOLDER_ID,
    folderPath: '/nowhere',
    builtAtMs: 1_700_000_000_000,
    parserVersions: { markdown: '1' },
    documentCount: 99,
    chunkCount: 99,
    failedCount: 99,
    embedding: null,
    ...overrides,
  }
}

function payloadOf(
  documents: readonly DocumentRecord[] = [documentOf(0), documentOf(1, 'failed')],
  chunks: readonly ChunkRecord[] = [chunkOf(0)],
  overrides: Partial<IndexManifest> = {},
): IndexPayload {
  return { manifest: manifestOf(overrides), documents, chunks, vectors: [] }
}

describe('reading an index that was never written', () => {
  it('reports no manifest', async () => {
    expect(await data.store.readManifest(FOLDER_ID)).toBeNull()
  })

  it('reports no documents and no chunks', async () => {
    expect(await data.store.readDocuments(FOLDER_ID)).toEqual([])
    expect(await data.store.readChunks(FOLDER_ID)).toEqual([])
  })

  it('reports no size', async () => {
    expect(await data.store.sizeBytes(FOLDER_ID)).toBe(0)
  })
})

describe('writing an index', () => {
  it('round-trips the manifest, the documents and the chunks', async () => {
    const documents = [documentOf(0), documentOf(1, 'failed')]
    const chunks = [chunkOf(0)]
    await data.store.replaceIndex(FOLDER_ID, payloadOf(documents, chunks))

    expect(await data.store.readDocuments(FOLDER_ID)).toEqual(documents)
    expect(await data.store.readChunks(FOLDER_ID)).toEqual(chunks)
    expect(await data.store.readManifest(FOLDER_ID)).toEqual({
      ...manifestOf(),
      documentCount: 2,
      chunkCount: 1,
      failedCount: 1,
    })
  })

  it('derives the counts instead of trusting the ones it was handed', async () => {
    const manifest = await data.store.replaceIndex(FOLDER_ID, payloadOf())

    expect(manifest.documentCount).toBe(2)
    expect(manifest.chunkCount).toBe(1)
    expect(manifest.failedCount).toBe(1)
  })

  it('leaves no temporary file and no staging directory behind', async () => {
    await data.store.replaceIndex(FOLDER_ID, payloadOf())

    const files = await readdir(indexDirectory(dataDir, FOLDER_ID))
    expect(files.sort()).toEqual(['chunks.jsonl', 'documents.jsonl', 'manifest.json'])
    expect(files.some((file) => file.endsWith('.tmp'))).toBe(false)
    await expect(readdir(stagingDirectory(dataDir, FOLDER_ID))).rejects.toThrow()
  })

  it('writes byte-identical files for identical input', async () => {
    await data.store.replaceIndex(FOLDER_ID, payloadOf())
    const first = await readFile(join(indexDirectory(dataDir, FOLDER_ID), 'chunks.jsonl'), 'utf8')
    const firstManifest = await readFile(
      join(indexDirectory(dataDir, FOLDER_ID), 'manifest.json'),
      'utf8',
    )

    await data.store.replaceIndex(FOLDER_ID, payloadOf())
    const second = await readFile(join(indexDirectory(dataDir, FOLDER_ID), 'chunks.jsonl'), 'utf8')
    const secondManifest = await readFile(
      join(indexDirectory(dataDir, FOLDER_ID), 'manifest.json'),
      'utf8',
    )

    expect(second).toBe(first)
    expect(secondManifest).toBe(firstManifest)
  })

  it('declares its schema version next to the manifest', async () => {
    await data.store.replaceIndex(FOLDER_ID, payloadOf())
    const raw = await readFile(join(indexDirectory(dataDir, FOLDER_ID), 'manifest.json'), 'utf8')

    expect(JSON.parse(raw)).toMatchObject({ schemaVersion: 1 })
    expect(raw.endsWith('\n')).toBe(true)
  })

  it('reports its size once it is written', async () => {
    expect(await data.store.sizeBytes(FOLDER_ID)).toBe(0)
    await data.store.replaceIndex(FOLDER_ID, payloadOf())
    expect(await data.store.sizeBytes(FOLDER_ID)).toBeGreaterThan(0)
  })
})

describe('a write that fails', () => {
  it('leaves the index that was already there untouched', async () => {
    await data.store.replaceIndex(FOLDER_ID, payloadOf())
    const before = await data.store.readChunks(FOLDER_ID)

    // A BigInt cannot be serialised, so this fails part-way through the write.
    const broken = {
      ...payloadOf(),
      chunks: [{ ...chunkOf(0), charStart: 1n as unknown as number }],
    }
    await expect(data.store.replaceIndex(FOLDER_ID, broken)).rejects.toMatchObject({
      code: 'INDEX_FAILED',
    })

    expect(await data.store.readChunks(FOLDER_ID)).toEqual(before)
    expect(await data.store.readManifest(FOLDER_ID)).not.toBeNull()
  })

  it('cleans up the staging directory it had started', async () => {
    await expect(
      data.store.replaceIndex(FOLDER_ID, {
        ...payloadOf(),
        chunks: [{ ...chunkOf(0), charStart: 1n as unknown as number }],
      }),
    ).rejects.toMatchObject({ code: 'INDEX_FAILED' })

    await expect(readdir(stagingDirectory(dataDir, FOLDER_ID))).rejects.toThrow()
  })
})

describe('an index from another version', () => {
  it('is refused rather than read', async () => {
    const directory = indexDirectory(dataDir, FOLDER_ID)
    await mkdir(directory, { recursive: true })
    await writeFile(
      join(directory, 'manifest.json'),
      JSON.stringify({ schemaVersion: 99, manifest: manifestOf() }),
      'utf8',
    )

    await expect(data.store.readManifest(FOLDER_ID)).rejects.toMatchObject({
      code: 'INDEX_CORRUPT',
    })
  })

  it('is refused when it is not valid JSON at all', async () => {
    const directory = indexDirectory(dataDir, FOLDER_ID)
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'manifest.json'), 'not json', 'utf8')

    await expect(data.store.readManifest(FOLDER_ID)).rejects.toMatchObject({
      code: 'INDEX_CORRUPT',
    })
  })

  it('is refused when a record file is not valid JSON', async () => {
    const directory = indexDirectory(dataDir, FOLDER_ID)
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'chunks.jsonl'), 'not json\n', 'utf8')

    await expect(data.store.readChunks(FOLDER_ID)).rejects.toMatchObject({
      code: 'INDEX_CORRUPT',
    })
  })
})

describe('recovering from a swap that was interrupted', () => {
  it('reads the previous index when the live one is missing', async () => {
    await data.store.replaceIndex(FOLDER_ID, payloadOf())
    await rename(indexDirectory(dataDir, FOLDER_ID), previousDirectory(dataDir, FOLDER_ID))

    expect(await data.store.readManifest(FOLDER_ID)).not.toBeNull()
    expect(await data.store.readChunks(FOLDER_ID)).toEqual([chunkOf(0)])
    expect(await data.store.sizeBytes(FOLDER_ID)).toBeGreaterThan(0)
  })

  it('clears the leftovers on the next successful write', async () => {
    await data.store.replaceIndex(FOLDER_ID, payloadOf())
    await rename(indexDirectory(dataDir, FOLDER_ID), previousDirectory(dataDir, FOLDER_ID))
    await data.store.replaceIndex(FOLDER_ID, payloadOf())

    await expect(readdir(previousDirectory(dataDir, FOLDER_ID))).rejects.toThrow()
    expect(await data.store.readChunks(FOLDER_ID)).toEqual([chunkOf(0)])
  })
})

describe('deleting an index', () => {
  it('removes everything it wrote', async () => {
    await data.store.replaceIndex(FOLDER_ID, payloadOf())
    await data.store.remove(FOLDER_ID)

    expect(await data.store.readManifest(FOLDER_ID)).toBeNull()
    expect(await data.store.readDocuments(FOLDER_ID)).toEqual([])
    expect(await data.store.sizeBytes(FOLDER_ID)).toBe(0)
    await expect(readdir(indexDirectory(dataDir, FOLDER_ID))).rejects.toThrow()
  })

  it('succeeds when there is nothing to delete', async () => {
    await expect(data.store.remove(FOLDER_ID)).resolves.toBeUndefined()
    await data.store.replaceIndex(FOLDER_ID, payloadOf())
    await data.store.remove(FOLDER_ID)
    await expect(data.store.remove(FOLDER_ID)).resolves.toBeUndefined()
  })

  it('removes a staging directory and a leftover previous index too', async () => {
    await mkdir(stagingDirectory(dataDir, FOLDER_ID), { recursive: true })
    await mkdir(previousDirectory(dataDir, FOLDER_ID), { recursive: true })
    await data.store.remove(FOLDER_ID)

    await expect(readdir(stagingDirectory(dataDir, FOLDER_ID))).rejects.toThrow()
    await expect(readdir(previousDirectory(dataDir, FOLDER_ID))).rejects.toThrow()
  })

  it('leaves another folder alone', async () => {
    const other = 'cccccccdddddddd'
    await data.store.replaceIndex(FOLDER_ID, payloadOf())
    await data.store.replaceIndex(other, payloadOf())
    await data.store.remove(FOLDER_ID)

    expect(await data.store.readManifest(other)).not.toBeNull()
    expect(await data.store.readManifest(FOLDER_ID)).toBeNull()
  })
})

describe('deleting every index', () => {
  it('removes the whole index tree, and is idempotent', async () => {
    await data.store.replaceIndex(FOLDER_ID, payloadOf())
    await data.removeAllIndexes()

    expect(await data.store.readManifest(FOLDER_ID)).toBeNull()
    await expect(data.removeAllIndexes()).resolves.toBeUndefined()
    // The marker belongs to the data directory, not to the indexes: removing every index
    // does not mean mulat stopped owning the directory it still keeps its config in.
    // `deleteDataDirectory` is what removes the marker, and the directory with it.
    expect(await readdir(dataDir)).toEqual(['.mulat-data'])
  })
})
