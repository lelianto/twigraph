import { assertGrounded } from '@twigraph/shared'
import type {
  Answer,
  AnswerEngine,
  Citation,
  Passage,
  RetrievalSnapshot,
  SearchHit,
} from '@twigraph/shared'

import { tokenize } from './tokenize'

const SENTENCE_BOUNDARY = /(?<=[.!?])\s+/

function sentencesOf(text: string): readonly string[] {
  return text
    .split(SENTENCE_BOUNDARY)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0)
}

function scoreSentence(sentence: string, queryTerms: ReadonlySet<string>): number {
  const sentenceTokens = tokenize(sentence)
  let count = 0
  for (const token of sentenceTokens) {
    if (queryTerms.has(token)) count += 1
  }
  return count
}

function citationFor(hit: SearchHit, marker: number): Citation {
  return {
    marker,
    chunkId: hit.chunkId,
    filename: hit.filename,
    absolutePath: hit.absolutePath,
    ...(hit.page === undefined ? {} : { page: hit.page }),
    ...(hit.pageEnd === undefined ? {} : { pageEnd: hit.pageEnd }),
    headingPath: hit.headingPath,
    excerpt: hit.excerpt,
  }
}

export function createExtractiveAnswerEngine(): AnswerEngine {
  return {
    id: 'extractive',
    label: 'Extractive (Local)',
    isAvailable: async () => true,
    answer: async (question: string, snapshot: RetrievalSnapshot): Promise<Answer> => {
      if (!snapshot.confident || snapshot.hits.length === 0) {
        return {
          status: 'insufficient',
          text: 'No reliable answer found.',
          passages: [],
          citations: [],
          provider: 'extractive',
          unverifiedMarkers: [],
          sources: snapshot.hits,
        }
      }

      const queryTerms = new Set(tokenize(question))
      const citations: Citation[] = []
      const passages: Passage[] = []
      const answerParts: string[] = []

      // Consider top hits (up to 2 best distinct passages)
      const topHits = snapshot.hits.slice(0, 2)

      for (const hit of topHits) {
        const sentences = sentencesOf(hit.text)
        if (sentences.length === 0) continue

        let bestSentence = sentences[0]!
        let bestScore = scoreSentence(bestSentence, queryTerms)

        for (let i = 1; i < sentences.length; i += 1) {
          const candidate = sentences[i]!
          const score = scoreSentence(candidate, queryTerms)
          if (score > bestScore) {
            bestScore = score
            bestSentence = candidate
          }
        }

        const marker = citations.length + 1
        const citation = citationFor(hit, marker)
        citations.push(citation)

        const passage: Passage = {
          text: bestSentence,
          citationMarkers: [marker],
        }
        passages.push(passage)
        answerParts.push(`${bestSentence} [${marker}]`)
      }

      if (passages.length === 0) {
        return {
          status: 'insufficient',
          text: 'No reliable answer found.',
          passages: [],
          citations: [],
          provider: 'extractive',
          unverifiedMarkers: [],
          sources: snapshot.hits,
        }
      }

      const answer: Answer = {
        status: 'answered',
        text: answerParts.join('\n\n'),
        passages,
        citations,
        provider: 'extractive',
        unverifiedMarkers: [],
        sources: snapshot.hits,
      }

      const chunkTextsById = new Map<string, string>()
      for (const [id, chunk] of snapshot.chunksById) {
        chunkTextsById.set(id, chunk.text)
      }
      for (const hit of snapshot.hits) {
        if (!chunkTextsById.has(hit.chunkId)) {
          chunkTextsById.set(hit.chunkId, hit.text)
        }
      }

      assertGrounded(answer, chunkTextsById)
      return answer
    },
  }
}
