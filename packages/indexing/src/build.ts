import { createParserRegistry, defaultParsers, scanFolder } from '@twigraph/document-ingestion'
import type {
  ScanOptions,
  ScanSkip,
  ScannedFile,
  VersionedParser,
} from '@twigraph/document-ingestion'
import { TwigraphError, isTwigraphError } from '@twigraph/shared'
import type {
  ChunkRecord,
  DocumentFailure,
  DocumentRecord,
  IndexManifest,
  IndexPayload,
  IndexPhase,
} from '@twigraph/shared'

import { chunkDocument, type ChunkingOptions } from './chunk'
import { documentIdFor } from './ids'
import type { DataStore } from './index-store'

export interface BuildProgress {
  readonly phase: IndexPhase
  readonly documentsTotal: number
  readonly documentsProcessed: number
  readonly chunksWritten: number
  /** The file just handled. Never its contents. */
  readonly currentFile: string | null
}

export interface BuildIndexOptions {
  readonly folderId: string
  readonly folderPath: string
  /** Supplied by the caller: the engine never reads the ambient clock. */
  readonly nowMs: number
  readonly chunking: ChunkingOptions
  readonly scan?: ScanOptions
  readonly onProgress?: (progress: BuildProgress) => void
  /**
   * Cooperative cancellation. Checked before the scan and at every file boundary, so a
   * cancelled run stops between documents: never mid-file, and never after the new index
   * has begun to be put in place.
   */
  readonly signal?: AbortSignal
}

export interface BuildIndexResult {
  readonly manifest: IndexManifest
  readonly skipped: readonly ScanSkip[]
  readonly failures: readonly DocumentFailure[]
}

/**
 * A failed file becomes a document record, not a hole.
 *
 * Keeping it in the index is what makes "why is this document missing" answerable from the
 * index itself, and it means a later re-index still knows the file was there.
 */
function failedRecord(
  folderId: string,
  file: ScannedFile,
  failure: { code: DocumentFailure['code']; message: string },
): DocumentRecord {
  return {
    id: documentIdFor(folderId, file.relativePath),
    folderId,
    filename: file.relativePath.split('/').pop() ?? file.relativePath,
    relativePath: file.relativePath,
    absolutePath: file.absolutePath,
    extension: file.extension,
    sizeBytes: file.sizeBytes,
    modifiedAtMs: file.modifiedAtMs,
    contentHash: file.contentHash,
    chunkCount: 0,
    status: 'failed',
    errorCode: failure.code,
    errorMessage: failure.message,
  }
}

/**
 * Stops a cancelled run where it is safe to stop.
 *
 * `replaceIndex` is what creates the staging directory, so throwing before it is reached is
 * what guarantees a cancelled run leaves the previous index exactly as it was. A half-built
 * index would be worse than the one the user already has.
 */
function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw new TwigraphError('CANCELLED', 'The indexing run was cancelled')
  }
}

/**
 * Reads a folder and writes its index.
 *
 * A parser that reports a failure against one file never stops the run: the file is
 * recorded as failed and the next one is read. A file the scan declined never reaches a
 * parser at all, and is reported separately, so nothing is dropped in silence.
 */
export async function buildIndex(
  data: DataStore,
  options: BuildIndexOptions,
): Promise<BuildIndexResult> {
  const registry = createParserRegistry(defaultParsers())
  const { folderId, folderPath, nowMs, chunking, onProgress, signal } = options

  throwIfAborted(signal)

  const scan = await scanFolder(folderPath, {
    ...options.scan,
    supportedExtensions: registry.extensions,
  })

  const previousDocs = new Map<string, DocumentRecord>()
  const previousChunksByDocId = new Map<string, ChunkRecord[]>()
  let previousManifest: IndexManifest | null = null

  try {
    const [manifest, existingDocs, existingChunks] = await Promise.all([
      data.store.readManifest(folderId),
      data.store.readDocuments(folderId),
      data.store.readChunks(folderId),
    ])
    previousManifest = manifest
    for (const doc of existingDocs) {
      if (doc.status === 'indexed') {
        previousDocs.set(doc.relativePath, doc)
      }
    }
    for (const chunk of existingChunks) {
      let list = previousChunksByDocId.get(chunk.documentId)
      if (list === undefined) {
        list = []
        previousChunksByDocId.set(chunk.documentId, list)
      }
      list.push(chunk)
    }
  } catch {
    // If the existing index is corrupt or unreadable, start fresh
  }

  const documents: DocumentRecord[] = []
  const chunks: ChunkRecord[] = []
  const failures: DocumentFailure[] = []
  let processed = 0

  const report = (currentFile: string | null): void => {
    onProgress?.({
      phase: currentFile === null ? 'writing' : 'parsing',
      documentsTotal: scan.files.length,
      documentsProcessed: processed,
      chunksWritten: chunks.length,
      currentFile,
    })
  }

  report(null)

  for (const file of scan.files) {
    throwIfAborted(signal)
    processed += 1
    const parser: VersionedParser | null = registry.forExtension(file.extension)
    const documentId = documentIdFor(folderId, file.relativePath)

    if (parser === null) {
      // The scan already filtered by the registry's extensions, so this should not happen.
      // Reporting it beats dropping the file without a word.
      failures.push({
        absolutePath: file.absolutePath,
        relativePath: file.relativePath,
        code: 'PARSE_UNSUPPORTED_FORMAT',
        message: 'No parser claims this file type',
      })
      report(file.relativePath)
      continue
    }

    const cachedDoc = previousDocs.get(file.relativePath)
    const cachedChunks = previousChunksByDocId.get(documentId)
    const parserMatches =
      previousManifest !== null && previousManifest.parserVersions[parser.id] === parser.version

    if (
      parserMatches &&
      cachedDoc !== undefined &&
      cachedChunks !== undefined &&
      cachedDoc.contentHash === file.contentHash &&
      cachedDoc.sizeBytes === file.sizeBytes &&
      cachedDoc.chunkCount === cachedChunks.length
    ) {
      documents.push({
        ...cachedDoc,
        modifiedAtMs: file.modifiedAtMs,
      })
      chunks.push(...cachedChunks)
      report(file.relativePath)
      continue
    }

    try {
      const parsed = await parser.parse({
        absolutePath: file.absolutePath,
        relativePath: file.relativePath,
        sizeBytes: file.sizeBytes,
        modifiedAtMs: file.modifiedAtMs,
        contentHash: file.contentHash,
      })

      const documentChunks = chunkDocument(parsed, documentId, chunking)
      chunks.push(...documentChunks)

      documents.push({
        id: documentId,
        folderId,
        filename: parsed.metadata.filename,
        relativePath: parsed.metadata.relativePath,
        absolutePath: parsed.metadata.absolutePath,
        extension: parsed.metadata.extension,
        sizeBytes: parsed.metadata.sizeBytes,
        modifiedAtMs: parsed.metadata.modifiedAtMs,
        contentHash: parsed.metadata.contentHash,
        chunkCount: documentChunks.length,
        ...(parsed.metadata.title === undefined ? {} : { title: parsed.metadata.title }),
        ...(parsed.metadata.pageCount === undefined
          ? {}
          : { pageCount: parsed.metadata.pageCount }),
        status: 'indexed',
      })
    } catch (error) {
      const failure = isTwigraphError(error)
        ? { code: error.code, message: error.message }
        : { code: 'INTERNAL' as const, message: 'The document could not be read' }
      failures.push({
        absolutePath: file.absolutePath,
        relativePath: file.relativePath,
        ...failure,
      })
      documents.push(failedRecord(folderId, file, failure))
    }

    report(file.relativePath)
  }

  // The counts are left at zero on purpose: the store derives them from the records it
  // actually wrote, so a manifest can never disagree with the files beside it.
  const payload: IndexPayload = {
    manifest: {
      folderId,
      folderPath,
      builtAtMs: nowMs,
      parserVersions: registry.versions,
      documentCount: 0,
      chunkCount: 0,
      failedCount: 0,
      embedding: null,
    },
    documents,
    chunks,
    vectors: [],
  }

  const manifest = await data.store.replaceIndex(folderId, payload)
  report(null)

  return { manifest, skipped: scan.skipped, failures }
}
