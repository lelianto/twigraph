import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { generateFixtures } from '../../../fixtures/generate.mjs'
import { installNetworkGuard } from '../../../tests/setup/no-network'
import { buildIndex } from '../src/build'
import type { BuildProgress } from '../src/build'
import { createIndexStore } from '../src/index-store'
import type { DataStore } from '../src/index-store'
import { indexDirectory } from '../src/layout'

const FOLDER_ID = 'aaaaaaaabbbbbbbb'
const NOW = 1_700_000_000_000
const CHUNKING = { targetTokens: 900, overlapRatio: 0.12 }

let root = ''
let dataDir = ''
let data: DataStore

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'twigraph-build-src-'))
  dataDir = await mkdtemp(join(tmpdir(), 'twigraph-build-data-'))
  await generateFixtures(root)
  data = createIndexStore({ dataDir })
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
  await rm(dataDir, { recursive: true, force: true })
})

const build = (overrides: Partial<Parameters<typeof buildIndex>[1]> = {}) =>
  buildIndex(data, {
    folderId: FOLDER_ID,
    folderPath: root,
    nowMs: NOW,
    chunking: CHUNKING,
    ...overrides,
  })

const chunkFileOf = async (): Promise<string> =>
  readFile(join(indexDirectory(dataDir, FOLDER_ID), 'chunks.jsonl'), 'utf8')

describe('building an index from a folder', () => {
  it('counts what it indexed and what it could not', async () => {
    const result = await build()

    expect(result.manifest.documentCount).toBe(11)
    expect(result.manifest.failedCount).toBe(3)
    expect(result.manifest.chunkCount).toBeGreaterThan(10)
    expect(result.manifest.parserVersions).toEqual({ html: '1', markdown: '1', text: '1' })
    expect(result.manifest.builtAtMs).toBe(NOW)
    expect(result.manifest.embedding).toBeNull()
  })

  it('names the files it failed on, with a code and no document text', async () => {
    const result = await build()

    expect(result.failures.map((failure) => failure.relativePath).sort()).toEqual([
      'edge/empty.txt',
      'edge/invalid-utf8.txt',
      'edge/whitespace-only.txt',
    ])
    expect(result.failures.map((failure) => failure.code).sort()).toEqual([
      'PARSE_EMPTY',
      'PARSE_EMPTY',
      'PARSE_FAILED',
    ])
    for (const failure of result.failures) {
      expect(failure.message).not.toContain(root)
    }
  })

  it('keeps a failed file in the index as a failed document', async () => {
    await build()
    const documents = await data.store.readDocuments(FOLDER_ID)
    const failed = documents.filter((document) => document.status === 'failed')

    expect(documents).toHaveLength(11)
    expect(failed).toHaveLength(3)
    expect(failed.map((document) => document.errorCode)).toContain('PARSE_FAILED')
    expect(failed.every((document) => document.chunkCount === 0)).toBe(true)
    expect(failed.every((document) => document.id.length === 16)).toBe(true)
  })

  it('reports what the scan declined, separately from the documents it failed to parse', async () => {
    const result = await build()

    expect(result.skipped).toEqual([
      { relativePath: '.git', reason: 'ignored-directory' },
      { relativePath: '.hidden', reason: 'hidden' },
      { relativePath: 'edge/no-extension', reason: 'unsupported-extension' },
      { relativePath: 'edge/unsupported.csv', reason: 'unsupported-extension' },
      { relativePath: 'node_modules', reason: 'ignored-directory' },
    ])
  })

  it('gives every markdown chunk a heading trail, and every text chunk none', async () => {
    await build()
    const chunks = await data.store.readChunks(FOLDER_ID)
    const documents = await data.store.readDocuments(FOLDER_ID)
    const extensionOf = new Map(documents.map((document) => [document.id, document.extension]))

    expect(chunks.length).toBeGreaterThan(10)
    for (const chunk of chunks) {
      // A plain text file has no headings at all, so its citations fall back to the
      // filename rather than pointing at a section that does not exist.
      if (extensionOf.get(chunk.documentId) === '.md') {
        expect(chunk.headingPath.length).toBeGreaterThan(0)
      } else {
        expect(chunk.headingPath).toEqual([])
      }
      expect(chunk.charEnd).toBeGreaterThan(chunk.charStart)
      expect(chunk.id).toBe(`${chunk.documentId}:${chunk.ordinal}`)
    }
  })

  it('stores a citation trail back to the file the user picked', async () => {
    await build()
    const documents = await data.store.readDocuments(FOLDER_ID)
    const retrieval = documents.find((document) => document.relativePath === 'notes/retrieval.md')
    const chunks = await data.store.readChunks(FOLDER_ID)

    expect(retrieval?.absolutePath).toBe(join(root, 'notes', 'retrieval.md'))
    expect(retrieval?.title).toBe('Retrieval')
    expect(chunks.some((chunk) => chunk.documentId === retrieval?.id)).toBe(true)
  })

  it('reports progress without ever naming a chunk', async () => {
    const seen: BuildProgress[] = []
    await build({ onProgress: (progress) => seen.push(progress) })

    expect(seen.length).toBeGreaterThan(10)
    expect(seen.some((progress) => progress.currentFile === 'notes/retrieval.md')).toBe(true)
    expect(seen.at(-1)).toMatchObject({ documentsProcessed: 11, currentFile: null })
    for (const progress of seen) {
      expect(JSON.stringify(progress).length).toBeLessThan(200)
    }
  })

  it('writes a byte-identical index on a second run', async () => {
    await build()
    const first = await chunkFileOf()
    await build()

    expect(await chunkFileOf()).toBe(first)
  })

  it('replaces the previous index rather than adding to it', async () => {
    await build()
    const first = await data.store.readChunks(FOLDER_ID)
    await build()

    expect(await data.store.readChunks(FOLDER_ID)).toEqual(first)
  })

  it('updates modified file during incremental re-indexing', async () => {
    await build()
    const initialDocs = await data.store.readDocuments(FOLDER_ID)
    const targetDoc = initialDocs.find((doc) => doc.relativePath === 'notes/retrieval.md')
    expect(targetDoc).toBeDefined()

    // Modify the file
    const { writeFile } = await import('node:fs/promises')
    await writeFile(join(root, 'notes/retrieval.md'), '# Updated Heading\n\nBrand new content.')

    await build()
    const updatedDocs = await data.store.readDocuments(FOLDER_ID)
    const updatedTarget = updatedDocs.find((doc) => doc.relativePath === 'notes/retrieval.md')
    expect(updatedTarget?.contentHash).not.toBe(targetDoc?.contentHash)

    const updatedChunks = await data.store.readChunks(FOLDER_ID)
    const newDocChunk = updatedChunks.find((chunk) => chunk.documentId === targetDoc?.id)
    expect(newDocChunk?.text).toContain('Brand new content.')
  })

  it('touches no network at all', async () => {
    const guard = installNetworkGuard({ mode: 'offline' })
    try {
      await build()
      expect(guard.attempts()).toEqual([])
      expect(guard.blocked()).toEqual([])
    } finally {
      guard.restore()
    }
  })

  it('can be deleted completely afterwards', async () => {
    await build()
    await data.store.remove(FOLDER_ID)

    expect(await data.store.readManifest(FOLDER_ID)).toBeNull()
    expect(await data.store.readChunks(FOLDER_ID)).toEqual([])
    await expect(data.store.sizeBytes(FOLDER_ID)).resolves.toBe(0)
  })
})

describe('cancelling a run', () => {
  it('refuses to start when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(build({ signal: controller.signal })).rejects.toMatchObject({ code: 'CANCELLED' })
  })

  it('leaves no index behind when a first run is cancelled', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(build({ signal: controller.signal })).rejects.toMatchObject({ code: 'CANCELLED' })
    expect(await data.store.readManifest(FOLDER_ID)).toBeNull()
  })

  it('stops at a file boundary rather than walking the whole folder', async () => {
    const controller = new AbortController()
    const seen: BuildProgress[] = []

    await expect(
      build({
        signal: controller.signal,
        onProgress: (progress) => {
          seen.push(progress)
          if (progress.documentsProcessed === 3) controller.abort()
        },
      }),
    ).rejects.toMatchObject({ code: 'CANCELLED' })

    expect(seen.at(-1)?.documentsProcessed).toBe(3)
    expect(seen.length).toBeLessThan(11)
  })

  it('leaves the index the user already had exactly as it was', async () => {
    await build()
    const before = await chunkFileOf()
    const chunksBefore = await data.store.readChunks(FOLDER_ID)

    const controller = new AbortController()
    await expect(
      build({
        signal: controller.signal,
        onProgress: (progress) => {
          if (progress.documentsProcessed === 3) controller.abort()
        },
      }),
    ).rejects.toMatchObject({ code: 'CANCELLED' })

    expect(await chunkFileOf()).toBe(before)
    expect(await data.store.readChunks(FOLDER_ID)).toEqual(chunksBefore)
  })

  it('runs to completion when the signal never fires', async () => {
    const controller = new AbortController()
    const result = await build({ signal: controller.signal })

    expect(result.manifest.documentCount).toBe(11)
  })
})
