import type { Bm25Config } from '@twigraph/shared'

import { tokenize } from './tokenize'

export interface IndexableChunk {
  readonly id: string
  readonly text: string
}

export interface LexicalIndex {
  readonly chunkIds: readonly string[]
  readonly lengths: readonly number[]
  /** term -> chunk position -> term frequency */
  readonly postings: ReadonlyMap<string, ReadonlyMap<number, number>>
  readonly averageLength: number
}

export interface ScoredChunk {
  readonly chunkId: string
  /** Normalised into `[0, 1]`, which is what makes a threshold meaningful. */
  readonly score: number
  /** 0 based position in this rank list. */
  readonly rank: number
}

function inverseDocumentFrequency(chunkCount: number, documentFrequency: number): number {
  return Math.log(1 + (chunkCount - documentFrequency + 0.5) / (documentFrequency + 0.5))
}

/**
 * Builds the term statistics.
 *
 * Identical input always produces an identical index: nothing here reads a clock, a locale
 * or a random source, and the chunk order is the caller's.
 */
export function buildLexicalIndex(chunks: readonly IndexableChunk[]): LexicalIndex {
  const chunkIds: string[] = []
  const lengths: number[] = []
  const postings = new Map<string, Map<number, number>>()
  let totalLength = 0

  for (const [position, chunk] of chunks.entries()) {
    const tokens = tokenize(chunk.text)
    chunkIds.push(chunk.id)
    lengths.push(tokens.length)
    totalLength += tokens.length

    for (const token of tokens) {
      let posting = postings.get(token)
      if (posting === undefined) {
        posting = new Map()
        postings.set(token, posting)
      }
      posting.set(position, (posting.get(position) ?? 0) + 1)
    }
  }

  return {
    chunkIds,
    lengths,
    postings,
    averageLength: chunkIds.length === 0 ? 0 : totalLength / chunkIds.length,
  }
}

/**
 * BM25 with `k1 = 1.2`, `b = 0.75`, normalised into `[0, 1]`.
 *
 * The raw BM25 number is not comparable between queries — a query of rare terms scores
 * far higher than a query of common ones for equally good matches. Dividing by the best
 * score the query could possibly reach (`sum(idf) * (k1 + 1)`) turns it into "how much of
 * the query's own weight did this chunk account for", which is what a confidence gate
 * needs. A query whose terms barely appear scores near zero and is refused rather than
 * answered.
 */
export function searchLexical(
  index: LexicalIndex,
  query: string,
  options: Bm25Config & { readonly topK: number },
): readonly ScoredChunk[] {
  const terms = [...new Set(tokenize(query))]
  if (terms.length === 0 || index.chunkIds.length === 0) return []

  const chunkCount = index.chunkIds.length
  const { k1, b } = options
  const scores = new Map<number, number>()
  let idfSum = 0

  for (const term of terms) {
    const posting = index.postings.get(term)
    const documentFrequency = posting?.size ?? 0
    const idf = inverseDocumentFrequency(chunkCount, documentFrequency)
    idfSum += idf
    if (posting === undefined) continue

    for (const [position, frequency] of posting) {
      const length = index.lengths[position] ?? 0
      const denominator = frequency + k1 * (1 - b + (b * length) / (index.averageLength || 1))
      const contribution = (idf * (frequency * (k1 + 1))) / denominator
      scores.set(position, (scores.get(position) ?? 0) + contribution)
    }
  }

  const maximum = idfSum * (k1 + 1)
  const scored: ScoredChunk[] = []
  for (const [position, raw] of scores) {
    const chunkId = index.chunkIds[position]
    if (chunkId === undefined) continue
    scored.push({ chunkId, score: maximum === 0 ? 0 : raw / maximum, rank: 0 })
  }

  // Score first, then the chunk id. Without the second key two chunks with the same score
  // would come back in Map insertion order, and two runs could disagree.
  scored.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score
    return left.chunkId < right.chunkId ? -1 : left.chunkId > right.chunkId ? 1 : 0
  })

  return scored
    .slice(0, Math.max(0, options.topK))
    .map((hit, rank) => ({ chunkId: hit.chunkId, score: hit.score, rank }))
}
