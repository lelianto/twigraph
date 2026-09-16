import type { AnswerProviderId } from './answer'

export interface PrepareProgress {
  readonly phase: 'download' | 'load'
  readonly file: string
  readonly loadedBytes: number
  readonly totalBytes: number
}

/**
 * Local embeddings. `prepare` is the only call that may touch the network, and only when
 * the user asked for it — everything else must work with no model present.
 */
export interface EmbeddingProvider {
  readonly id: string
  readonly dim: number
  readonly label: string
  isAvailable(): Promise<boolean>
  prepare(onProgress?: (progress: PrepareProgress) => void): Promise<void>
  embed(texts: readonly string[]): Promise<readonly Float32Array[]>
}

/** One numbered context block handed to a language model. */
export interface ContextBlock {
  readonly marker: number
  readonly chunkId: string
  readonly text: string
}

export interface GenerateRequest {
  readonly question: string
  readonly context: readonly ContextBlock[]
}

export interface GenerateOptions {
  readonly signal?: AbortSignal
  readonly onToken?: (token: string) => void
}

export interface GeneratedAnswer {
  readonly text: string
  /** Markers the model actually used, in order of first appearance. */
  readonly usedMarkers: readonly number[]
  /** Markers it used that were never offered. These are dropped, and reported. */
  readonly invalidMarkers: readonly number[]
  readonly model: string
}

export interface LanguageModelProvider {
  readonly id: AnswerProviderId
  readonly label: string
  isAvailable(): Promise<boolean>
  listModels(): Promise<readonly string[]>
  generate(request: GenerateRequest, options?: GenerateOptions): Promise<GeneratedAnswer>
}
