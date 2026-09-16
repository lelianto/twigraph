import { describe, expect, it } from 'vitest'
import { describeLocation, formatCitationLabel, formatHeadingPath } from '../src/citations'
import type { Citation } from '../src/contracts/answer'

const base = {
  marker: 1,
  chunkId: 'c1',
  filename: 'report.pdf',
  absolutePath: 'C:\\docs\\report.pdf',
  headingPath: [],
  excerpt: 'excerpt',
} satisfies Citation

describe('formatPageRange', () => {
  it('describes a single page', () => {
    expect(describeLocation({ ...base, page: 4 })).toBe('p. 4')
  })

  it('collapses a range', () => {
    expect(describeLocation({ ...base, page: 4, pageEnd: 6 })).toBe('pp. 4–6')
  })

  it('does not repeat the page when the range is a single page', () => {
    expect(describeLocation({ ...base, page: 4, pageEnd: 4 })).toBe('p. 4')
  })
})

describe('formatHeadingPath', () => {
  it('joins a heading trail with a section sign', () => {
    expect(formatHeadingPath(['Methods', 'Sampling'])).toBe('§ Methods › Sampling')
  })

  it('returns null for an empty trail', () => {
    expect(formatHeadingPath([])).toBeNull()
  })
})

describe('describeLocation', () => {
  it('combines page and heading when both exist', () => {
    expect(describeLocation({ ...base, page: 12, headingPath: ['Results'] })).toBe(
      'p. 12 · § Results',
    )
  })

  it('uses only the heading when there is no page', () => {
    expect(describeLocation({ ...base, headingPath: ['Intro'] })).toBe('§ Intro')
  })

  it('falls back to the filename when there is neither', () => {
    expect(describeLocation(base)).toBe('report.pdf')
  })
})

describe('formatCitationLabel', () => {
  it('reads as filename plus location', () => {
    expect(formatCitationLabel({ ...base, page: 4, headingPath: ['Methods'] })).toBe(
      'report.pdf — p. 4 · § Methods',
    )
  })
})
