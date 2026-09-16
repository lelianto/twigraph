import { MulatError, collapseWhitespace } from '@mulat/shared'
import type {
  ChunkRecord,
  DocumentRecord,
  RetrievalConfig,
  Retriever,
  SearchHit,
  SearchOptions,
  SearchResult,
} from '@mulat/shared'

import { buildLexicalIndex, searchLexical } from './bm25'
import { tokenize } from './tokenize'

const EXCERPT_CHARS = 240

export interface SearchCorpus {
  readonly chunks: readonly ChunkRecord[]
  readonly documents: readonly DocumentRecord[]
}

export interface RetrieverOptions {
  readonly config: RetrievalConfig
  /** Injected so a test can pin the reported duration. */
  readonly now?: () => number
}

/**
 * A short window around the first place the query appears.
 *
 * The point of an excerpt is to let someone judge a hit without opening the file, so it is
 * centred on the match rather than being the first 240 characters of the chunk.
 */
function excerptOf(text: string, terms: readonly string[]): string {
  const flat = collapseWhitespace(text)
  if (flat.length <= EXCERPT_CHARS) return flat

  const lower = flat.toLowerCase()
  let at = -1
  for (const term of terms) {
    const found = lower.indexOf(term)
    if (found !== -1 && (at === -1 || found < at)) at = found
  }

  const start = at === -1 ? 0 : Math.max(0, at - Math.floor(EXCERPT_CHARS / 4))
  const body = flat.slice(start, start + EXCERPT_CHARS)
  return `${start === 0 ? '' : '…'}${body}${start + EXCERPT_CHARS < flat.length ? '…' : ''}`
}

/**
 * Whether the top hit is strong enough to be worth answering from.
 *
 * This runs before any language model is called, which is the whole point: a weak query
 * must be refused, not handed to a model that will happily invent something.
 */
export function meetsConfidence(result: SearchResult, minScore: number): boolean {
  const top = result.hits[0]
  return top !== undefined && top.score >= minScore
}

/**
 * A retriever over whatever the loader hands it.
 *
 * It never opens a file itself — it works on records an `IndexStore` read — which is what
 * lets the whole ranking path be tested without a disk. The corpus is loaded per search
 * rather than cached, so a search after a re-index sees the new index.
 */
export function createRetriever(
  loadCorpus: () => Promise<SearchCorpus>,
  options: RetrieverOptions,
): Retriever {
  const now = options.now ?? (() => Date.now())
  const { config } = options

  return {
    search: async (query: string, searchOptions?: SearchOptions): Promise<SearchResult> => {
      const started = now()
      const trimmed = query.trim()
      if (trimmed === '') {
        throw new MulatError('QUERY_EMPTY', 'Enter something to search for')
      }

      const corpus = await loadCorpus()
      const index = buildLexicalIndex(corpus.chunks)
      const scored = searchLexical(index, trimmed, {
        topK: searchOptions?.topK ?? config.topK,
        ...config.bm25,
      })

      const chunksById = new Map(corpus.chunks.map((chunk) => [chunk.id, chunk]))
      const documentsById = new Map(corpus.documents.map((document) => [document.id, document]))
      const terms = [...new Set(tokenize(trimmed))]
      const hits: SearchHit[] = []

      for (const hit of scored) {
        const chunk = chunksById.get(hit.chunkId)
        if (chunk === undefined) continue
        const document = documentsById.get(chunk.documentId)
        // A chunk whose document is not in the index cannot be cited: there would be no
        // file to open. Dropping it is better than showing a source that does not exist.
        if (document === undefined) continue

        hits.push({
          chunkId: chunk.id,
          documentId: chunk.documentId,
          filename: document.filename,
          absolutePath: document.absolutePath,
          ...(chunk.page === undefined ? {} : { page: chunk.page }),
          ...(chunk.pageEnd === undefined ? {} : { pageEnd: chunk.pageEnd }),
          headingPath: chunk.headingPath,
          excerpt: excerptOf(chunk.text, terms),
          text: chunk.text,
          score: hit.score,
          ranks: { bm25: hit.rank },
        })
      }

      return {
        query: trimmed,
        // No vectors exist yet, so this is the lexical path and says so.
        mode: 'lexical',
        hits,
        tookMs: Math.max(0, Math.round(now() - started)),
      }
    },
  }
}
