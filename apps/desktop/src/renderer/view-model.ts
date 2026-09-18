import { formatCitationLabel, formatHeadingPath, formatPageRange } from '@twigraph/shared/citations'
import type { FolderSummary, IndexProgressEvent } from '@twigraph/shared/ipc'
import type { Answer, Citation, SearchHit, SearchResult } from '@twigraph/shared'

/**
 * Everything the window shows, as plain functions.
 *
 * Keeping the formatting out of the components is what makes it testable without a DOM: the
 * `.tsx` files decide where things go, these decide what they say.
 */

export type WorkspacePhase = 'no-folders' | 'needs-index' | 'ready' | 'answer' | 'search-results'

export interface WorkspaceState {
  readonly folders: readonly FolderSummary[]
  readonly activeFolderId: string | null
  readonly answer: Answer | null
  readonly result: SearchResult | null
}

export function workspacePhase(state: WorkspaceState): WorkspacePhase {
  if (state.answer !== null) return 'answer'
  if (state.result !== null) return 'search-results'
  if (state.folders.length === 0) return 'no-folders'

  const active = state.folders.find((folder) => folder.id === state.activeFolderId)
  const folder = active ?? state.folders[0]
  return folder?.lastIndexedAtMs === null ? 'needs-index' : 'ready'
}

export interface GroupedAnswerSources {
  readonly cited: readonly SearchHit[]
  readonly additional: readonly SearchHit[]
}

export function groupAnswerSources(answer: Answer): GroupedAnswerSources {
  const citedIds = new Set(answer.citations.map((citation) => citation.chunkId))
  return {
    cited: answer.sources.filter((source) => citedIds.has(source.chunkId)),
    additional: answer.sources.filter((source) => !citedIds.has(source.chunkId)),
  }
}

export function accessibleHitLabel(hit: SearchHit): string {
  const locations = [hitHeading(hit), hitPageRange(hit)].filter(
    (location): location is string => location !== null,
  )
  const where = locations.length === 0 ? '' : `, ${locations.join(', ')}`
  return `${hit.filename}${where}, relevance ${formatScore(hit.score)}`
}

export function resultStatus({
  answer,
  result,
}: {
  readonly answer: Answer | null
  readonly result: SearchResult | null
}): string {
  if (answer !== null) {
    if (answer.status === 'insufficient') {
      const count = answer.sources.length
      return `No reliable answer. ${count} closest passage${count === 1 ? '' : 's'} available.`
    }
    const count = answer.citations.length
    return `Answer ready with ${count} source${count === 1 ? '' : 's'}.`
  }
  if (result !== null) {
    const count = result.hits.length
    return `${count} matching passage${count === 1 ? '' : 's'} found.`
  }
  return ''
}

export interface AnswerLine {
  readonly text: string
  /**
   * The markers this line cites, in the order they appear. A line can draw on more than one
   * source, and the first one is the one the judge would call the primary.
   */
  readonly markers: readonly number[]
}

const PASSAGE_BREAK = /\n{2,}/
const MARKER_SCAN = /\[(\d+)\]/g
const MARKER_STRIP = /\[(\d+)\]/g
const SPACE_BEFORE_PUNCTUATION = /\s+([.,;:!?])/g
const RUN_OF_SPACES = /\s{2,}/g

/**
 * Splits an answer into the lines it should be drawn on, with the markers pulled out.
 *
 * The markers are lifted out of the sentence rather than left inline because the window shows
 * them as a thread to the source, not as text. `[docs]` is left alone: only digits are markers.
 */
export function answerLines(text: string): readonly AnswerLine[] {
  return text
    .split(PASSAGE_BREAK)
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((line) => {
      const markers: number[] = []
      for (const match of line.matchAll(MARKER_SCAN)) {
        const marker = Number(match[1])
        if (!markers.includes(marker)) markers.push(marker)
      }

      return {
        text: line
          .replace(MARKER_STRIP, '')
          .replace(SPACE_BEFORE_PUNCTUATION, '$1')
          .replace(RUN_OF_SPACES, ' ')
          .trim(),
        markers,
      }
    })
}

/** The source a marker points at, or nothing when the marker is not a real one. */
export function citationFor(answer: Answer, marker: number): Citation | undefined {
  return answer.citations.find((citation) => citation.marker === marker)
}

export function citationLabel(citation: Citation): string {
  return formatCitationLabel(citation)
}

/** A search hit has a location but no marker yet: the marker is assigned when it is cited. */
export function hitHeading(hit: SearchHit): string | null {
  return formatHeadingPath(hit.headingPath)
}

export function hitPageRange(hit: SearchHit): string | null {
  return formatPageRange(hit)
}

export function formatScore(score: number): string {
  return score.toFixed(2)
}

/**
 * The last segment of a path, for a label a person can scan.
 *
 * Windows is the only platform this ships on, but both separators are accepted so a path that
 * arrived from either side of a copy-paste still reads correctly.
 */
export function folderName(path: string): string {
  const parts = path.split(/[\\/]/).filter((part) => part !== '')
  return parts[parts.length - 1] ?? path
}

export function formatBytes(bytes: number): string {
  const safe = Math.max(0, bytes)
  if (safe < 1024) return `${Math.round(safe)} B`

  const units = ['KB', 'MB', 'GB', 'TB']
  let value = safe
  let unit = -1
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(1)} ${units[unit] ?? 'KB'}`
}

/**
 * What a folder row says about its index.
 *
 * "Indexed, but nothing readable" is a different fact from "not indexed yet", and an index of
 * nothing that reports a byte count would hide which of the two happened.
 */
export function folderStateLine(folder: FolderSummary): string {
  if (folder.lastIndexedAtMs === null) return 'Not indexed yet'
  if (folder.documentCount === 0) return 'Indexed, but nothing in it could be read'

  const parts = [
    `${folder.documentCount} document${folder.documentCount === 1 ? '' : 's'}`,
    `${folder.chunkCount} chunk${folder.chunkCount === 1 ? '' : 's'}`,
  ]
  if (folder.failedCount > 0) parts.push(`${folder.failedCount} unreadable`)
  parts.push(formatBytes(folder.indexSizeBytes))
  return parts.join('  ')
}

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS
const OLD_ENOUGH_FOR_A_DATE = 30 * DAY_MS

/** `null` means the folder has never been indexed, which is a different thing from "long ago". */
export function formatWhen(atMs: number | null, nowMs: number): string {
  if (atMs === null) return 'Not indexed yet'

  const elapsed = nowMs - atMs
  if (elapsed < MINUTE_MS) return 'Just now'
  if (elapsed < HOUR_MS) {
    const minutes = Math.floor(elapsed / MINUTE_MS)
    return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  }
  if (elapsed < DAY_MS) {
    const hours = Math.floor(elapsed / HOUR_MS)
    return `${hours} hour${hours === 1 ? '' : 's'} ago`
  }
  if (elapsed < OLD_ENOUGH_FOR_A_DATE) {
    const days = Math.floor(elapsed / DAY_MS)
    return `${days} day${days === 1 ? '' : 's'} ago`
  }
  return new Date(atMs).toISOString().slice(0, 10)
}

/**
 * One line for the status bar. It names the file being read and never anything inside it.
 */
export function describeIndexProgress(progress: IndexProgressEvent): string {
  const counted = `${progress.documentsProcessed} of ${progress.documentsTotal}`
  return progress.currentFile === null
    ? `Writing the index — ${counted}`
    : `Reading ${progress.currentFile} — ${counted}`
}

/**
 * Which side panels the window is showing.
 *
 * Both are open until someone minimizes one, and the choice outlives the window: it is stored in
 * local storage beside the theme, so the layout a person chose is the layout they come back to.
 * The state lives on the shell as a class rather than on each pane, so the two panels cannot
 * disagree about how wide the window thinks they are.
 */
export type SidePanel = 'rail' | 'inspector'

export interface PanelLayout {
  readonly rail: boolean
  readonly inspector: boolean
}

const OPEN_BOTH: PanelLayout = { rail: true, inspector: true }

/** Anything but an explicit `false` counts as never minimized. */
function panelIsOpen(decoded: unknown, panel: SidePanel): boolean {
  if (typeof decoded !== 'object' || decoded === null) return true
  return (decoded as Record<string, unknown>)[panel] !== false
}

export function parsePanelLayout(stored: string | null): PanelLayout {
  if (stored === null) return OPEN_BOTH

  try {
    const decoded: unknown = JSON.parse(stored)
    return { rail: panelIsOpen(decoded, 'rail'), inspector: panelIsOpen(decoded, 'inspector') }
  } catch {
    // A note the window cannot read is not a reason to open a window with no panels in it.
    return OPEN_BOTH
  }
}

/** Written in a fixed order, so the same layout always stores the same string. */
export function formatPanelLayout(layout: PanelLayout): string {
  return JSON.stringify({ rail: layout.rail, inspector: layout.inspector })
}

export function panelShellClass(layout: PanelLayout): string {
  const minimized = [
    layout.rail ? '' : 'app--rail-min',
    layout.inspector ? '' : 'app--inspector-min',
  ].filter((name) => name !== '')
  return ['app', ...minimized].join(' ')
}

/** What using a toggle will do, so the button keeps one name as its panel opens and closes. */
export function panelToggleLabel(panel: SidePanel, open: boolean): string {
  return `${open ? 'Hide' : 'Show'} ${panel === 'rail' ? 'folders' : 'evidence'}`
}
