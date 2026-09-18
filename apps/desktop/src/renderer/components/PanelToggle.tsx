import { panelToggleLabel } from '../view-model'
import type { SidePanel } from '../view-model'

export interface PanelToggleProps {
  readonly panel: SidePanel
  /** The pane's element id, so the button and the region it opens are tied together. */
  readonly controls: string
  readonly open: boolean
  readonly onToggle: () => void
}

/**
 * The control that minimizes a side panel, drawn the same way on both sides.
 *
 * The chevron points the way the panel is about to move — the rail leaves to the left, the
 * evidence panel to the right — and the label names the action, so the button keeps one meaning
 * whether its panel is open or closed.
 */
export function PanelToggle({ panel, controls, open, onToggle }: PanelToggleProps) {
  const label = panelToggleLabel(panel, open)
  const pointsLeft = panel === 'rail' ? open : !open

  return (
    <button
      type="button"
      className="pane__toggle"
      aria-expanded={open}
      aria-controls={controls}
      aria-label={label}
      title={label}
      onClick={onToggle}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path
          d={pointsLeft ? 'M15 5 8 12l7 7' : 'M9 5l7 7-7 7'}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  )
}
