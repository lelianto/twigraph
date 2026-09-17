import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { TwigraphError, ensureDataDirectory } from '@twigraph/shared'
import type {
  ChunkRecord,
  DocumentRecord,
  IndexManifest,
  IndexPayload,
  IndexStore,
} from '@twigraph/shared'

import {
  INDEX_SCHEMA_VERSION,
  indexDirectory,
  indexesRoot,
  previousDirectory,
  stagingDirectory,
} from './layout'
import { parseJsonLines, stableStringify, toJsonLines } from './serialize'

const DOCUMENTS_FILE = 'documents.jsonl'
const CHUNKS_FILE = 'chunks.jsonl'
const MANIFEST_FILE = 'manifest.json'

export interface IndexStoreOptions {
  readonly dataDir: string
}

export interface DataStore {
  readonly store: IndexStore
  /** Removes every index, leaving the data directory itself alone. */
  removeAllIndexes(): Promise<void>
  /** The index directory a folder would use, whether or not it exists. */
  directoryOf(folderId: string): string
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/**
 * The directory a read should use.
 *
 * A crash between the two renames of a swap leaves the old index under `.old` and nothing
 * at the live path. Preferring the live path and falling back to `.old` means a search
 * running at that moment still sees the last complete index instead of nothing at all,
 * without any read ever mutating the disk.
 */
async function resolveDirectory(dataDir: string, folderId: string): Promise<string | null> {
  const live = indexDirectory(dataDir, folderId)
  if (await pathExists(live)) return live
  const previous = previousDirectory(dataDir, folderId)
  if (await pathExists(previous)) return previous
  return null
}

async function writeFileAtomic(path: string, contents: string): Promise<void> {
  const temporary = `${path}.tmp`
  await writeFile(temporary, contents, 'utf8')
  await rename(temporary, path)
}

/**
 * Counts are derived from the payload rather than trusted from the caller.
 *
 * A manifest that disagrees with the files next to it is a manifest that will send someone
 * looking for a missing document that was never there.
 */
function deriveManifest(payload: IndexPayload): IndexManifest {
  return {
    ...payload.manifest,
    documentCount: payload.documents.length,
    chunkCount: payload.chunks.length,
    failedCount: payload.documents.filter((document) => document.status === 'failed').length,
  }
}

async function readLines<T>(directory: string, file: string): Promise<readonly T[]> {
  let raw: string
  try {
    raw = await readFile(join(directory, file), 'utf8')
  } catch (error) {
    throw new TwigraphError('INDEX_CORRUPT', 'A file of this index could not be read', {
      cause: error,
    })
  }
  try {
    return parseJsonLines<T>(raw)
  } catch (error) {
    throw new TwigraphError('INDEX_CORRUPT', 'A file of this index is not valid JSON', {
      cause: error,
    })
  }
}

async function directorySize(path: string): Promise<number> {
  let total = 0
  let entries
  try {
    entries = await readdir(path, { withFileTypes: true })
  } catch {
    return 0
  }
  for (const entry of entries) {
    const full = join(path, entry.name)
    if (entry.isDirectory()) {
      total += await directorySize(full)
      continue
    }
    if (!entry.isFile()) continue
    try {
      total += (await stat(full)).size
    } catch {
      // A file that vanished mid-walk contributes nothing rather than failing the call.
    }
  }
  return total
}

export function createIndexStore(options: IndexStoreOptions): DataStore {
  const { dataDir } = options

  /** Builds the new index beside the old one and puts it in place with two renames. */
  async function swap(staging: string, live: string, previous: string): Promise<void> {
    await rm(previous, { recursive: true, force: true })
    const hadLive = await pathExists(live)
    if (hadLive) await rename(live, previous)

    try {
      await rename(staging, live)
    } catch (error) {
      if (hadLive) {
        try {
          await rename(previous, live)
        } catch {
          // Nothing further can be done here; the caller is told the write failed and the
          // next successful re-index cleans up whatever is left.
        }
      }
      throw new TwigraphError('INDEX_FAILED', 'The new index could not be put in place', {
        cause: error,
      })
    }

    await rm(previous, { recursive: true, force: true })
  }

  const store: IndexStore = {
    readManifest: async (folderId: string): Promise<IndexManifest | null> => {
      const directory = await resolveDirectory(dataDir, folderId)
      if (directory === null) return null

      let raw: string
      try {
        raw = await readFile(join(directory, MANIFEST_FILE), 'utf8')
      } catch (error) {
        throw new TwigraphError('INDEX_CORRUPT', 'The index has no manifest', { cause: error })
      }

      let envelope: unknown
      try {
        envelope = JSON.parse(raw)
      } catch (error) {
        throw new TwigraphError('INDEX_CORRUPT', 'The index manifest is not valid JSON', {
          cause: error,
        })
      }

      const schemaVersion = (envelope as { schemaVersion?: unknown }).schemaVersion
      if (schemaVersion !== INDEX_SCHEMA_VERSION) {
        throw new TwigraphError(
          'INDEX_CORRUPT',
          `This index was written by another version of twigraph and cannot be read. Re-index this folder.`,
          { detail: { found: String(schemaVersion), expected: INDEX_SCHEMA_VERSION } },
        )
      }

      const manifest = (envelope as { manifest?: IndexManifest }).manifest
      if (manifest === undefined) {
        throw new TwigraphError('INDEX_CORRUPT', 'The index manifest is missing its contents')
      }
      return manifest
    },

    readDocuments: async (folderId: string): Promise<readonly DocumentRecord[]> => {
      const directory = await resolveDirectory(dataDir, folderId)
      if (directory === null) return []
      return readLines<DocumentRecord>(directory, DOCUMENTS_FILE)
    },

    readChunks: async (folderId: string): Promise<readonly ChunkRecord[]> => {
      const directory = await resolveDirectory(dataDir, folderId)
      if (directory === null) return []
      return readLines<ChunkRecord>(directory, CHUNKS_FILE)
    },

    replaceIndex: async (folderId: string, payload: IndexPayload): Promise<IndexManifest> => {
      const staging = stagingDirectory(dataDir, folderId)
      const live = indexDirectory(dataDir, folderId)
      const previous = previousDirectory(dataDir, folderId)
      const manifest = deriveManifest(payload)

      try {
        await rm(staging, { recursive: true, force: true })
        // The first index built into a fresh install is also what claims the directory.
        await ensureDataDirectory(dataDir)
        await mkdir(staging, { recursive: true })
        await writeFileAtomic(join(staging, DOCUMENTS_FILE), toJsonLines(payload.documents))
        await writeFileAtomic(join(staging, CHUNKS_FILE), toJsonLines(payload.chunks))
        // The manifest goes last, so a staging directory without one is understood to be
        // incomplete and is never mistaken for a finished index.
        await writeFileAtomic(
          join(staging, MANIFEST_FILE),
          `${stableStringify({ schemaVersion: INDEX_SCHEMA_VERSION, manifest }, 2)}\n`,
        )
      } catch (error) {
        await rm(staging, { recursive: true, force: true })
        throw new TwigraphError('INDEX_FAILED', 'The index could not be written', { cause: error })
      }

      await swap(staging, live, previous)
      return manifest
    },

    remove: async (folderId: string): Promise<void> => {
      for (const directory of [
        stagingDirectory(dataDir, folderId),
        indexDirectory(dataDir, folderId),
        previousDirectory(dataDir, folderId),
      ]) {
        await rm(directory, { recursive: true, force: true })
      }
    },

    sizeBytes: async (folderId: string): Promise<number> => {
      const directory = await resolveDirectory(dataDir, folderId)
      if (directory === null) return 0
      return directorySize(directory)
    },
  }

  return {
    store,
    removeAllIndexes: async (): Promise<void> => {
      await rm(indexesRoot(dataDir), { recursive: true, force: true })
    },
    directoryOf: (folderId: string) => indexDirectory(dataDir, folderId),
  }
}
