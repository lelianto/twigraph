import type { ChunkRecord, ParsedDocument } from '@mulat/shared'

export interface ChunkingOptions {
  readonly targetTokens: number
  readonly overlapRatio: number
}

/**
 * Tokens are estimated as `characters / 4`.
 *
 * Running a real tokenizer at chunk time would tie the index to one model's vocabulary,
 * and the index has to stay buildable with no model present at all.
 */
const CHARS_PER_TOKEN = 4

const PARAGRAPH_SEPARATOR = '\n\n'

/** A sentence terminator, the closing punctuation that may follow it, and the gap after. */
const SENTENCE_END = /[.!?][")'\]]*[ \t\n]+/g

interface Span {
  readonly start: number
  readonly end: number
  readonly page: number | undefined
  readonly headingPath: readonly string[]
}

interface Range {
  readonly start: number
  readonly end: number
}

/** Where each sentence begins in the document text. Computed once, not per chunk. */
function sentenceStartsIn(text: string): readonly number[] {
  const starts: number[] = []
  SENTENCE_END.lastIndex = 0
  let match = SENTENCE_END.exec(text)
  while (match !== null) {
    starts.push(match.index + match[0].length)
    match = SENTENCE_END.exec(text)
  }
  return starts
}

function lastSentenceEnd(window: string): number {
  SENTENCE_END.lastIndex = 0
  let last = -1
  let match = SENTENCE_END.exec(window)
  while (match !== null) {
    last = match.index + match[0].length
    match = SENTENCE_END.exec(window)
  }
  return last
}

/**
 * Cuts an oversized block into pieces, preferring a sentence boundary.
 *
 * A boundary is only used when it falls in the back half of the window; otherwise a single
 * early full stop would chop the document into one-sentence chunks and the index would
 * balloon for no gain.
 */
function splitLongBlock(
  text: string,
  absoluteStart: number,
  maxChars: number,
  firstMax: number = maxChars,
): readonly Range[] {
  const ranges: Range[] = []
  let cursor = 0

  while (cursor < text.length) {
    // The first piece may have to share its budget with a heading that came before it.
    const budget = Math.max(CHARS_PER_TOKEN, ranges.length === 0 ? firstMax : maxChars)
    if (text.length - cursor <= budget) {
      ranges.push({ start: absoluteStart + cursor, end: absoluteStart + text.length })
      break
    }

    const window = text.slice(cursor, cursor + budget)
    const boundary = lastSentenceEnd(window)
    const length = boundary >= Math.floor(window.length / 2) ? boundary : budget
    ranges.push({ start: absoluteStart + cursor, end: absoluteStart + cursor + length })
    cursor += length
  }

  return ranges
}

interface Summary {
  readonly page: number | undefined
  readonly pageEnd: number | undefined
  readonly headingPath: readonly string[]
}

/**
 * What a chunk covers: the page of its first block, the page of its last, and the heading
 * trail of the deepest block in it.
 *
 * The trail comes from the last block, not the first. A chunk holding several consecutive
 * headings covers all of them, and citing only the shallowest would make the citation
 * point at a section the answer did not come from.
 */
function summarize(spans: readonly Span[], range: Range): Summary {
  let page: number | undefined
  let pageEnd: number | undefined
  let anchor: Span | undefined

  for (const span of spans) {
    if (span.end <= range.start || span.start >= range.end) continue
    if (span.page !== undefined) {
      if (page === undefined) page = span.page
      pageEnd = span.page
    }
    anchor = span
  }

  return { page, pageEnd, headingPath: anchor?.headingPath ?? [] }
}

/** How far back a chunk reaches to repeat the tail of the one before it. */
function overlapStart(
  sentenceStarts: readonly number[],
  from: number,
  limit: number,
  floor: number,
  previousStart: number,
): number {
  if (limit <= 0) return from

  const target = Math.max(floor, from - limit)
  if (target >= from) return from

  // The last sentence beginning at or before the target. Taking the last one rather than
  // the first after it is what makes the overlap reliable: cores already start at sentence
  // boundaries, so the first boundary after the target is usually the core's own start,
  // which would leave no overlap at all. The cost is at most one sentence more than asked
  // for, which is the direction a reader would want anyway.
  let chosen = -1
  for (const start of sentenceStarts) {
    if (start > target) break
    if (start >= floor) chosen = start
  }

  // No boundary in reach, or one that would reach past the chunk being repeated. Either
  // way, no overlap is better than a fragment or a swallowed neighbour.
  if (chosen === -1) return from
  if (chosen < previousStart + 1) return from
  return chosen
}

/**
 * Turns a parsed document into chunks.
 *
 * Structure comes first: a heading always begins a new chunk, because the heading trail is
 * the citation anchor and a chunk carrying two trails has no anchor at all. Overlap is
 * therefore only ever taken from within one section.
 */
export function chunkDocument(
  document: ParsedDocument,
  documentId: string,
  options: ChunkingOptions,
): readonly ChunkRecord[] {
  const blocks = document.blocks.filter((block) => block.text.trim() !== '')
  if (blocks.length === 0) return []

  const documentText = blocks.map((block) => block.text).join(PARAGRAPH_SEPARATOR)
  const maxChars = Math.max(CHARS_PER_TOKEN, Math.floor(options.targetTokens * CHARS_PER_TOKEN))
  const overlapChars = Math.round(maxChars * options.overlapRatio)
  const sentenceStarts = sentenceStartsIn(documentText)

  const levels: string[] = []
  const spans: Span[] = []
  let cursor = 0

  for (const block of blocks) {
    if (block.kind === 'heading') {
      const level = Math.min(6, Math.max(1, block.level ?? 1))
      levels.length = level - 1
      levels.push(block.text)
    }

    const start = cursor
    const end = start + block.text.length
    spans.push({ start, end, page: block.page, headingPath: [...levels] })
    cursor = end + PARAGRAPH_SEPARATOR.length
  }

  // Segments never cross a heading. Consecutive headings stay together, because a heading
  // on its own carries no answer and would only add an empty chunk to the index.
  const segments: (readonly number[])[] = []
  let current: number[] = []
  let currentHasContent = false

  for (const [index, block] of blocks.entries()) {
    if (block.kind === 'heading' && currentHasContent) {
      segments.push(current)
      current = []
      currentHasContent = false
    }
    current.push(index)
    if (block.kind !== 'heading') currentHasContent = true
  }
  if (current.length > 0) segments.push(current)

  const chunks: ChunkRecord[] = []
  let ordinal = 0

  for (const segment of segments) {
    const cores: Range[] = []
    let pendingStart = -1
    let pendingEnd = -1

    for (const index of segment) {
      const span = spans[index]
      if (span === undefined) continue

      if (span.end - span.start > maxChars) {
        const budget =
          pendingStart === -1
            ? maxChars
            : Math.max(CHARS_PER_TOKEN, maxChars - (span.start - pendingStart))
        const pieces = splitLongBlock(
          documentText.slice(span.start, span.end),
          span.start,
          maxChars,
          budget,
        )
        const first = pieces[0]
        if (first !== undefined) {
          // An oversized block swallows the heading that introduced it, rather than
          // leaving a one-word chunk holding nothing but a heading.
          cores.push(pendingStart === -1 ? first : { start: pendingStart, end: first.end })
          for (const piece of pieces.slice(1)) cores.push(piece)
        }
        pendingStart = -1
        pendingEnd = -1
        continue
      }

      if (pendingStart === -1) {
        pendingStart = span.start
        pendingEnd = span.end
        continue
      }

      if (span.end - pendingStart > maxChars) {
        cores.push({ start: pendingStart, end: pendingEnd })
        pendingStart = span.start
        pendingEnd = span.end
        continue
      }

      pendingEnd = span.end
    }

    if (pendingStart !== -1) cores.push({ start: pendingStart, end: pendingEnd })

    const floor = spans[segment[0] ?? 0]?.start ?? 0

    for (const [position, core] of cores.entries()) {
      const previous = cores[position - 1]
      const start =
        previous === undefined
          ? core.start
          : overlapStart(sentenceStarts, core.start, overlapChars, floor, previous.start)

      const summary = summarize(spans, core)

      chunks.push({
        id: `${documentId}:${ordinal}`,
        documentId,
        ordinal,
        text: documentText.slice(start, core.end),
        ...(summary.page === undefined ? {} : { page: summary.page }),
        ...(summary.pageEnd === undefined ? {} : { pageEnd: summary.pageEnd }),
        headingPath: summary.headingPath,
        charStart: start,
        charEnd: core.end,
      })

      ordinal += 1
    }
  }

  return chunks
}
