import type { ErrorCode } from '../errors'

/** A folder the user chose to index. The id is derived from the path, so it is stable. */
export interface FolderRecord {
  readonly id: string
  readonly path: string
  readonly addedAtMs: number
  readonly lastIndexedAtMs?: number
  readonly documentCount?: number
  readonly chunkCount?: number
}

export interface ChunkRecord {
  readonly id: string
  readonly documentId: string
  readonly ordinal: number
  /** The text as stored, and as used for lexical retrieval. */
  readonly text: string
  readonly page?: number
  readonly pageEnd?: number
  readonly headingPath: readonly string[]
  readonly charStart: number
  readonly charEnd: number
}

export interface DocumentRecord {
  readonly id: string
  readonly folderId: string
  readonly filename: string
  readonly relativePath: string
  readonly absolutePath: string
  readonly extension: string
  readonly sizeBytes: number
  readonly modifiedAtMs: number
  readonly contentHash: string
  readonly chunkCount: number
  readonly pageCount?: number
  readonly title?: string
  readonly status: 'indexed' | 'failed'
  readonly errorCode?: ErrorCode
  readonly errorMessage?: string
}

export interface EmbeddingSignature {
  readonly modelId: string
  readonly dim: number
  readonly dtype: string
}

export interface IndexManifest {
  readonly folderId: string
  readonly folderPath: string
  readonly builtAtMs: number
  /** Parser id to version, so a parser change can force a rebuild. */
  readonly parserVersions: Readonly<Record<string, string>>
  readonly documentCount: number
  readonly chunkCount: number
  readonly failedCount: number
  /** `null` when the index holds BM25 only. */
  readonly embedding: EmbeddingSignature | null
}

export interface VectorEntry {
  readonly chunkId: string
  readonly vector: Float32Array
}

export interface IndexPayload {
  readonly manifest: IndexManifest
  readonly documents: readonly DocumentRecord[]
  readonly chunks: readonly ChunkRecord[]
  readonly vectors: readonly VectorEntry[]
}

export interface IndexStats {
  readonly manifest: IndexManifest
  readonly sizeBytes: number
}

/**
 * The folder registry. Implementations back onto the config file, which is why adding a
 * folder and deleting its index are separate operations.
 */
export interface FolderRegistry {
  list(): Promise<readonly FolderRecord[]>
  find(folderId: string): Promise<FolderRecord | null>
  add(folderPath: string, nowMs: number): Promise<FolderRecord>
  update(folderId: string, patch: Partial<Omit<FolderRecord, 'id' | 'path'>>): Promise<FolderRecord>
  remove(folderId: string): Promise<void>
}

export interface IndexStore {
  readManifest(folderId: string): Promise<IndexManifest | null>
  readDocuments(folderId: string): Promise<readonly DocumentRecord[]>
  readChunks(folderId: string): Promise<readonly ChunkRecord[]>
  /** Writes to a staging directory and swaps it in, so a live index is never mutated. */
  replaceIndex(folderId: string, payload: IndexPayload): Promise<IndexManifest>
  remove(folderId: string): Promise<void>
  sizeBytes(folderId: string): Promise<number>
}

export interface VectorHit {
  readonly chunkId: string
  /** Cosine similarity, so 1 means identical direction. */
  readonly score: number
  /** 0-based position in the vector rank list. */
  readonly rank: number
}

export interface VectorStore {
  writeIndex(folderId: string, entries: readonly VectorEntry[]): Promise<void>
  search(folderId: string, query: Float32Array, k: number): Promise<readonly VectorHit[]>
  readSignature(folderId: string): Promise<EmbeddingSignature | null>
  removeIndex(folderId: string): Promise<void>
}
