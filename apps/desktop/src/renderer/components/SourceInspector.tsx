import { useEffect } from 'react'

import type { SearchHit } from '@twigraph/shared'

import { hitHeading, hitPageRange } from '../view-model'
import { PanelToggle } from './PanelToggle'

export interface SelectedSource {
  readonly hit: SearchHit
  readonly marker: number | null
}

export interface SourceInspectorProps {
  readonly source: SelectedSource | null
  readonly onClose: () => void
  readonly onOpen: (absolutePath: string) => void
  readonly onReveal: (absolutePath: string) => void
  readonly panelOpen: boolean
  readonly onTogglePanel: () => void
}

export function SourceInspector({
  source,
  onClose,
  onOpen,
  onReveal,
  panelOpen,
  onTogglePanel,
}: SourceInspectorProps) {
  useEffect(() => {
    if (source === null) return
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose, source])

  const heading = source === null ? null : hitHeading(source.hit)
  const page = source === null ? null : hitPageRange(source.hit)

  return (
    <aside
      id="source-inspector"
      className={`pane pane--inspector${source === null ? '' : ' pane--inspector-open'}`}
      aria-labelledby="source-heading"
      data-source-inspector
    >
      <div className="inspector">
        <div className="inspector__head">
          <div className="inspector__title">
            <span className="pane__eyebrow">Evidence</span>
            <h2 id="source-heading">Selected source</h2>
          </div>
          <div className="inspector__controls">
            {/* The panel's own marker, kept for the minimized spine so both sides read the same. */}
            <span className="inspector__glyph" aria-hidden="true">
              [ ]
            </span>
            <PanelToggle
              panel="inspector"
              controls="source-inspector"
              open={panelOpen}
              onToggle={onTogglePanel}
            />
            <button
              type="button"
              className="button button--quiet inspector__close"
              onClick={onClose}
            >
              Close
            </button>
          </div>
        </div>

        {source === null ? (
          <div className="inspector__empty">
            <span className="inspector__empty-marker">[ ]</span>
            <p>Select a citation or passage to inspect its exact source text here.</p>
          </div>
        ) : (
          <>
            <div className="inspector__body">
              <p className="inspector__marker">
                {source.marker === null ? 'Retrieved passage' : `Source [${source.marker}]`}
              </p>
              <h3 className="inspector__name">{source.hit.filename}</h3>
              {heading === null && page === null ? null : (
                <p className="inspector__where">{[heading, page].filter(Boolean).join(' · ')}</p>
              )}
              <p className="inspector__path">{source.hit.absolutePath}</p>
              <div className="inspector__quote">
                <span>Exact indexed text</span>
                <p>{source.hit.text}</p>
              </div>
            </div>
            <div className="inspector__actions">
              <button
                type="button"
                className="button button--primary"
                onClick={() => onOpen(source.hit.absolutePath)}
              >
                Open file
              </button>
              <button
                type="button"
                className="button"
                onClick={() => onReveal(source.hit.absolutePath)}
              >
                Show in Explorer
              </button>
            </div>
          </>
        )}
      </div>
    </aside>
  )
}
