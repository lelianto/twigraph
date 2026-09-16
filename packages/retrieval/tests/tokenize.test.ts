import { describe, expect, it } from 'vitest'

import { tokenize } from '../src/tokenize'

describe('tokenizing', () => {
  it('folds case', () => {
    expect(tokenize('Retrieval RETRIEVAL retrieval')).toEqual([
      'retrieval',
      'retrieval',
      'retrieval',
    ])
  })

  it('splits on anything that is not a letter or a digit', () => {
    expect(tokenize('end-to-end, 10% of the time.')).toEqual([
      'end',
      'to',
      'end',
      '10',
      'of',
      'the',
      'time',
    ])
  })

  it('keeps letters outside ascii', () => {
    expect(tokenize('Könnte café naïve')).toEqual(['könnte', 'café', 'naïve'])
  })

  it('normalises a decomposed character to one token', () => {
    // 'e' followed by a combining acute accent is the same word as a precomposed 'é'.
    expect(tokenize('cafe\u0301')).toEqual(tokenize('café'))
    expect(tokenize('cafe\u0301')).toEqual(['café'])
  })

  it('keeps a trailing possessive as its own token rather than merging words', () => {
    expect(tokenize("the user's folder")).toEqual(['the', 'user', 's', 'folder'])
  })

  it('does not stem, because a stemmer is a language decision', () => {
    expect(tokenize('running runs')).toEqual(['running', 'runs'])
  })

  it('returns nothing for text with no letters or digits', () => {
    expect(tokenize('')).toEqual([])
    expect(tokenize('   ...  ---  ')).toEqual([])
  })
})
