import type { SearchHit } from '@twigraph/shared'

import { hitHeading, hitPageRange } from '../view-model'

export interface SelectedSource {
  readonly hit: SearchHit
  /** The marker it was reached through, when it was reached from an answer. */
  readonly marker: number | null
}

export interface SourceInspectorProps {
  readonly source: SelectedSource | null
  readonly onOpen: (absolutePath: string) => void
  readonly onReveal: (absolutePath: string) => void
}

/**
 * Exactly what the selected passage says, in full, with the two things a person wants next:
 * open the file, or show it in the folder it lives in.
 */
export function SourceInspector({ source, onOpen, onReveal }: SourceInspectorProps) {
  if (source === null) {
    return (
      <aside className="pane pane--inspector">
        <div className="inspector">
          <h2 className="pane__title">Source</h2>
          <div className="inspector__body">
            <p className="empty__body">
              Choose a passage and it appears here in full, with a way to open the file it came
              from.
            </p>
          </div>
        </div>
      </aside>
    )
  }

  const { hit, marker } = source
  const heading = hitHeading(hit)
  const page = hitPageRange(hit)

  return (
    <aside className="pane pane--inspector">
      <div className="inspector">
        <h2 className="pane__title">Source</h2>
        <div className="inspector__body">
          <p className="inspector__name">
            {marker === null ? null : <span className="inspector__where">[{marker}] </span>}
            {hit.filename}
          </p>
          {heading === null && page === null ? null : (
            <p className="inspector__where">
              {heading}
              {heading !== null && page !== null ? '  ' : ''}
              {page}
            </p>
          )}
          <p className="inspector__path">{hit.absolutePath}</p>
          <p className="inspector__text">{hit.text}</p>
        </div>
        <div className="inspector__actions">
          <button
            type="button"
            className="button button--primary"
            onClick={() => onOpen(hit.absolutePath)}
          >
            Open
          </button>
          <button type="button" className="button" onClick={() => onReveal(hit.absolutePath)}>
            Show in Explorer
          </button>
        </div>
      </div>
    </aside>
  )
}
