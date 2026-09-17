import type { Answer } from './contracts/answer'
import { TwigraphError } from './errors'

export function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * True when `excerpt` appears inside `source`, ignoring whitespace and case. Case folding
 * keeps a sentence that begins a chunk comparable to the same sentence mid-chunk; anything
 * beyond whitespace and case — a reworded clause, a swapped synonym — is not an excerpt.
 */
export function isVerbatimExcerpt(excerpt: string, source: string): boolean {
  const needle = collapseWhitespace(excerpt).toLowerCase()
  if (needle === '') return false
  return collapseWhitespace(source).toLowerCase().includes(needle)
}

/**
 * The invariant behind "an answer is only ever made of retrieved text".
 *
 * Extractive answers must satisfy this. Model-generated answers cannot — a model rewrites —
 * so they are validated differently (every `[n]` marker must map to a retrieved chunk) and
 * are never passed through here.
 */
export function assertGrounded(answer: Answer, chunkTextsById: ReadonlyMap<string, string>): void {
  if (answer.status !== 'answered') return

  if (answer.citations.length === 0) {
    throw new TwigraphError('INTERNAL', 'An answered answer must carry citations')
  }
  if (answer.passages.length === 0) {
    throw new TwigraphError('INTERNAL', 'An answered answer must carry at least one passage')
  }

  for (const passage of answer.passages) {
    if (passage.citationMarkers.length === 0) {
      throw new TwigraphError('INTERNAL', 'Every passage needs at least one citation marker')
    }

    const cited = passage.citationMarkers.map((marker) => {
      const citation = answer.citations.find((candidate) => candidate.marker === marker)
      if (citation === undefined) {
        throw new TwigraphError(
          'INTERNAL',
          `Passage cites marker [${marker}], which is not in the citation list`,
        )
      }
      return citation
    })

    const supported = cited.some((citation) => {
      const text = chunkTextsById.get(citation.chunkId)
      if (text === undefined) {
        throw new TwigraphError(
          'INTERNAL',
          `Chunk ${citation.chunkId} is not among the retrieved chunks`,
        )
      }
      return isVerbatimExcerpt(passage.text, text)
    })

    if (!supported) {
      throw new TwigraphError(
        'INTERNAL',
        'A passage must be a verbatim excerpt of one of the chunks it cites',
      )
    }
  }
}
