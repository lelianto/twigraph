import type { ChunkRecord, VectorEntry } from './stores'

export interface Citation {
  /** 1-based marker as it appears in the answer text, e.g. `[1]`. */
  readonly marker: number
  readonly chunkId: string
  readonly filename: string
  readonly absolutePath: string
  readonly page?: number
  readonly pageEnd?: number
  readonly headingPath: readonly string[]
  readonly excerpt: string
}

/** A fragment of an answer that came verbatim from a retrieved chunk. */
export interface Passage {
  readonly text: string
  /** Markers of the chunks this fragment was taken from. Never empty. */
  readonly citationMarkers: readonly number[]
}

export interface SearchHit {
  readonly chunkId: string
  readonly documentId: string
  readonly filename: string
  readonly absolutePath: string
  readonly page?: number
  readonly pageEnd?: number
  readonly headingPath: readonly string[]
  readonly excerpt: string
  readonly text: string
  /** Fused score, comparable only within one result set. */
  readonly score: number
  /** Where this hit placed in each retriever's rank list, 0-based. */
  readonly ranks: {
    readonly bm25?: number
    readonly vector?: number
  }
}

export interface SearchResult {
  readonly query: string
  /** `lexical` when no vectors were available, so the caller knows what it got. */
  readonly mode: 'lexical' | 'hybrid'
  readonly hits: readonly SearchHit[]
  readonly tookMs: number
}

export interface SearchOptions {
  readonly topK?: number
}

export interface Retriever {
  search(query: string, options?: SearchOptions): Promise<SearchResult>
}

export type AnswerProviderId = 'extractive' | 'ollama'

/**
 * An answer is either grounded in retrieved text, or it is the sentence
 * "No reliable answer found." — there is no third state.
 */
export interface Answer {
  readonly status: 'answered' | 'insufficient'
  /** The rendered answer, with `[n]` markers inline. */
  readonly text: string
  readonly passages: readonly Passage[]
  readonly citations: readonly Citation[]
  readonly provider: AnswerProviderId
  /** Present when a local model produced the answer. */
  readonly model?: string
  /** Markers the model emitted that did not map to a retrieved chunk. Never displayed. */
  readonly unverifiedMarkers: readonly number[]
  /** Why the answer is what it is, e.g. that a model was unavailable. */
  readonly note?: string
  /** Ranked sources, present even when the answer is insufficient. */
  readonly sources: readonly SearchHit[]
}

export interface RetrievalSnapshot {
  readonly hits: readonly SearchHit[]
  readonly chunksById: ReadonlyMap<string, ChunkRecord>
  readonly vectorsByChunkId: ReadonlyMap<string, VectorEntry>
  /** True when the top-ranked hit cleared the confidence gate. */
  readonly confident: boolean
}

export interface AnswerEngine {
  readonly id: AnswerProviderId
  /** A short label for the UI badge, e.g. "Ollama · llama3.2:3b". */
  readonly label: string
  isAvailable(): Promise<boolean>
  answer(question: string, snapshot: RetrievalSnapshot): Promise<Answer>
}
