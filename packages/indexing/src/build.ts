import { createParserRegistry, defaultParsers, scanFolder } from '@mulat/document-ingestion'
import type { ScanOptions, ScanSkip, ScannedFile, VersionedParser } from '@mulat/document-ingestion'
import { isMulatError } from '@mulat/shared'
import type {
  ChunkRecord,
  DocumentFailure,
  DocumentRecord,
  IndexManifest,
  IndexPayload,
  IndexPhase,
} from '@mulat/shared'

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
  const { folderId, folderPath, nowMs, chunking, onProgress } = options

  const scan = await scanFolder(folderPath, {
    ...options.scan,
    supportedExtensions: registry.extensions,
  })

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
      const failure = isMulatError(error)
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
