import { describe, expect, it } from 'vitest'
import type { Answer, Citation } from '../src/contracts/answer'
import { assertGrounded, collapseWhitespace, isVerbatimExcerpt } from '../src/grounding'

const CHUNK_ONE = 'Sampling was performed in two stages. The first stage covered urban areas.'
const CHUNK_TWO = 'The response rate reached sixty percent after two reminders.'

const citations: Citation[] = [
  {
    marker: 1,
    chunkId: 'c1',
    filename: 'report.pdf',
    absolutePath: '/docs/report.pdf',
    page: 4,
    headingPath: ['Methods'],
    excerpt: 'Sampling was performed in two stages.',
  },
  {
    marker: 2,
    chunkId: 'c2',
    filename: 'notes.md',
    absolutePath: '/docs/notes.md',
    headingPath: ['Results'],
    excerpt: 'The response rate reached sixty percent after two reminders.',
  },
]

const chunkTexts = new Map([
  ['c1', CHUNK_ONE],
  ['c2', CHUNK_TWO],
])

function answerWith(overrides: Partial<Answer> = {}): Answer {
  return {
    status: 'answered',
    text: 'Sampling was performed in two stages. [1]',
    passages: [{ text: 'Sampling was performed in two stages.', citationMarkers: [1] }],
    citations,
    provider: 'extractive',
    unverifiedMarkers: [],
    sources: [],
    ...overrides,
  }
}

describe('collapseWhitespace', () => {
  it('folds newlines, tabs and runs of spaces into single spaces', () => {
    expect(collapseWhitespace('a \n\t b   c')).toBe('a b c')
  })

  it('trims the ends', () => {
    expect(collapseWhitespace('   padded  ')).toBe('padded')
  })
})

describe('isVerbatimExcerpt', () => {
  it('accepts an exact excerpt', () => {
    expect(isVerbatimExcerpt('Sampling was performed in two stages.', CHUNK_ONE)).toBe(true)
  })

  it('accepts an excerpt that differs only in whitespace and case', () => {
    expect(isVerbatimExcerpt('sampling was  performed\nin two stages.', CHUNK_ONE)).toBe(true)
  })

  it('rejects a paraphrase', () => {
    expect(isVerbatimExcerpt('Sampling happened in two phases.', CHUNK_ONE)).toBe(false)
  })

  it('rejects text that spans two chunks the excerpt was not taken from', () => {
    expect(isVerbatimExcerpt('urban areas. The response rate', CHUNK_ONE)).toBe(false)
  })

  it('rejects an empty excerpt', () => {
    expect(isVerbatimExcerpt('', CHUNK_ONE)).toBe(false)
    expect(isVerbatimExcerpt('   ', CHUNK_ONE)).toBe(false)
  })
})

describe('assertGrounded', () => {
  it('accepts an answer whose passages are verbatim from their cited chunks', () => {
    const answer = answerWith({
      passages: [
        { text: 'Sampling was performed in two stages.', citationMarkers: [1] },
        {
          text: 'The response rate reached sixty percent after two reminders.',
          citationMarkers: [2],
        },
      ],
    })

    expect(() => assertGrounded(answer, chunkTexts)).not.toThrow()
  })

  it('accepts a passage supported by any one of its cited chunks', () => {
    const answer = answerWith({
      passages: [{ text: 'urban areas.', citationMarkers: [1, 2] }],
    })

    expect(() => assertGrounded(answer, chunkTexts)).not.toThrow()
  })

  it('rejects a passage that no cited chunk contains', () => {
    const answer = answerWith({
      passages: [{ text: 'Ninety percent of respondents agreed.', citationMarkers: [1] }],
    })

    expect(() => assertGrounded(answer, chunkTexts)).toThrowError(/verbatim/i)
  })

  it('rejects a passage with no citation at all', () => {
    const answer = answerWith({
      passages: [{ text: 'Sampling was performed in two stages.', citationMarkers: [] }],
    })

    expect(() => assertGrounded(answer, chunkTexts)).toThrowError(/citation/i)
  })

  it('rejects a passage citing a marker that is not in the citation list', () => {
    const answer = answerWith({
      passages: [{ text: 'Sampling was performed in two stages.', citationMarkers: [9] }],
    })

    expect(() => assertGrounded(answer, chunkTexts)).toThrowError(/marker/i)
  })

  it('rejects an answered answer with no citations', () => {
    expect(() => assertGrounded(answerWith({ citations: [] }), chunkTexts)).toThrowError(
      /citation/i,
    )
  })

  it('rejects a cited chunk that was never retrieved', () => {
    const answer = answerWith({
      passages: [{ text: 'Sampling was performed in two stages.', citationMarkers: [1] }],
    })

    expect(() => assertGrounded(answer, new Map())).toThrowError(/not among the retrieved/i)
  })

  it('does nothing for an insufficient answer, which claims nothing', () => {
    const answer = answerWith({
      status: 'insufficient',
      text: 'No reliable answer found.',
      passages: [],
      citations: [],
    })

    expect(() => assertGrounded(answer, chunkTexts)).not.toThrow()
  })
})
