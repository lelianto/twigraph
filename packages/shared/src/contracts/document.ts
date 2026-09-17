import type { ErrorCode } from '../errors'

/** The one shape every parser emits, so chunking and citations stay format-agnostic. */
export type BlockKind = 'heading' | 'paragraph' | 'list' | 'table' | 'code'

export interface Block {
  readonly kind: BlockKind
  /** 1–6 for a heading, absent otherwise. */
  readonly level?: number
  readonly text: string
  /** 1-based page number, when the format has pages. */
  readonly page?: number
}

export interface DocumentMetadata {
  readonly filename: string
  readonly relativePath: string
  readonly absolutePath: string
  /** Lowercase, with the leading dot. */
  readonly extension: string
  readonly sizeBytes: number
  readonly modifiedAtMs: number
  readonly contentHash: string
  readonly title?: string
  readonly pageCount?: number
  /** Non-fatal problems, e.g. an unreadable embedded font. */
  readonly parseWarnings: readonly string[]
}

export interface ParsedDocument {
  readonly metadata: DocumentMetadata
  readonly blocks: readonly Block[]
}

export interface ParseInput {
  readonly absolutePath: string
  readonly relativePath: string
  readonly sizeBytes: number
  readonly modifiedAtMs: number
  readonly contentHash: string
}

/**
 * A parser either returns a document or throws a `TwigraphError`. It never returns a partial
 * document with a silent gap: a file the pipeline cannot read is reported against that
 * file and the run carries on.
 */
export interface DocumentParser {
  readonly id: string
  /** Lowercase, with the leading dot. */
  readonly extensions: readonly string[]
  supports(extension: string): boolean
  parse(input: ParseInput): Promise<ParsedDocument>
}

export interface DocumentFailure {
  readonly absolutePath: string
  readonly relativePath: string
  readonly code: ErrorCode
  readonly message: string
}
