import type { Citation } from './contracts/answer'

const EN_DASH = '\u2013'
const EM_DASH = '\u2014'
const MIDDLE_DOT = '\u00b7'
const SECTION_SIGN = '\u00a7'
const SINGLE_RIGHT_ANGLE = '\u203a'

export function formatPageRange(citation: Pick<Citation, 'page' | 'pageEnd'>): string | null {
  const { page, pageEnd } = citation
  if (page === undefined) return null
  if (pageEnd !== undefined && pageEnd > page) return `pp. ${page}${EN_DASH}${pageEnd}`
  return `p. ${page}`
}

export function formatHeadingPath(headingPath: readonly string[]): string | null {
  if (headingPath.length === 0) return null
  return `${SECTION_SIGN} ${headingPath.join(` ${SINGLE_RIGHT_ANGLE} `)}`
}

/**
 * Where inside the document a citation points. Falls back to the filename when the format
 * gave us neither a page nor a heading, so the label is never empty.
 */
export function describeLocation(citation: Citation): string {
  const parts = [formatPageRange(citation), formatHeadingPath(citation.headingPath)].filter(
    (part): part is string => part !== null,
  )
  return parts.length === 0 ? citation.filename : parts.join(` ${MIDDLE_DOT} `)
}

export function formatCitationLabel(citation: Citation): string {
  return `${citation.filename} ${EM_DASH} ${describeLocation(citation)}`
}
