import type { Answer, SearchHit } from '@twigraph/shared'

import { answerLines, formatScore, hitHeading, hitPageRange } from '../view-model'

export interface AnswerLedgerProps {
  readonly answer: Answer
  readonly activeMarker: number | null
  readonly activeChunkId: string | null
  readonly onPickMarker: (marker: number) => void
  readonly onPickSource: (hit: SearchHit) => void
}

/**
 * The answer, drawn as a ledger rather than as a message.
 *
 * Each line keeps the thread back to the source it was taken from in the gutter beside it, so
 * what the window shows first is not the prose but where the prose came from. A line never
 * arrives without a source: the engine refuses to answer otherwise.
 */
export function AnswerLedger({
  answer,
  activeMarker,
  activeChunkId,
  onPickMarker,
  onPickSource,
}: AnswerLedgerProps) {
  const lines = answerLines(answer.text)
  const picking = activeMarker !== null

  return (
    <div className="ledger">
      {answer.status === 'insufficient' ? (
        <div className="ledger__ungrounded">
          <strong>No source was strong enough to answer from</strong>
          {answer.text}
        </div>
      ) : null}

      {answer.note === undefined ? null : <p className="ledger__note">{answer.note}</p>}

      {answer.unverifiedMarkers.length === 0 ? null : (
        <p className="ledger__note">
          The provider used {answer.unverifiedMarkers.length} marker
          {answer.unverifiedMarkers.length === 1 ? '' : 's'} that pointed at no retrieved passage.
          They are not shown, because a citation that leads nowhere is worse than none.
        </p>
      )}

      {answer.status === 'answered' ? (
        <p className="ledger__summary">
          {answer.citations.length} source{answer.citations.length === 1 ? '' : 's'}, quoted exactly
          from your files
        </p>
      ) : null}

      <div className={picking ? 'ledger--picking' : undefined}>
        {lines.map((line, index) => {
          const on = line.markers.includes(activeMarker ?? -1)
          return (
            <div key={index} className={`ledger__line${on ? ' ledger__line--on' : ''}`}>
              <div className="ledger__gutter">
                {line.markers.map((marker) => (
                  <button
                    key={marker}
                    type="button"
                    className={`ledger__marker${marker === activeMarker ? ' ledger__marker--on' : ''}`}
                    aria-label={`Source ${marker}`}
                    aria-pressed={marker === activeMarker}
                    onClick={() => onPickMarker(marker)}
                  >
                    {marker}
                  </button>
                ))}
                <span className="ledger__thread" aria-hidden="true" />
              </div>
              <p className="ledger__text">{line.text}</p>
            </div>
          )
        })}
      </div>

      {answer.sources.length === 0 ? null : (
        <>
          <p className="ledger__summary" style={{ marginTop: '26px' }}>
            {answer.status === 'answered' ? 'Every passage considered' : 'Closest passages'}
          </p>
          {answer.sources.map((hit) => (
            <HitRow
              key={hit.chunkId}
              hit={hit}
              selected={hit.chunkId === activeChunkId}
              onPick={onPickSource}
            />
          ))}
        </>
      )}
    </div>
  )
}

export interface HitRowProps {
  readonly hit: SearchHit
  readonly selected: boolean
  readonly onPick: (hit: SearchHit) => void
}

/** One ranked passage: its score, where it lives, and enough of it to judge without opening it. */
export function HitRow({ hit, selected, onPick }: HitRowProps) {
  const heading = hitHeading(hit)
  const page = hitPageRange(hit)

  return (
    <button
      type="button"
      className={`hit${selected ? ' hit--on' : ''}`}
      onClick={() => onPick(hit)}
    >
      <span className="hit__score">{formatScore(hit.score)}</span>
      <span>
        <span className="hit__name">{hit.filename}</span>
        {heading === null && page === null ? null : (
          <span className="hit__where">
            {heading}
            {heading !== null && page !== null ? '  ' : ''}
            {page}
          </span>
        )}
        <span className="hit__excerpt">{hit.excerpt}</span>
      </span>
    </button>
  )
}

/** The ranked list on its own, for a plain search. */
export function SearchHits({
  hits,
  activeChunkId,
  onPickSource,
}: {
  readonly hits: readonly SearchHit[]
  readonly activeChunkId: string | null
  readonly onPickSource: (hit: SearchHit) => void
}) {
  if (hits.length === 0) {
    return (
      <div className="empty">
        <p className="empty__title">Nothing matched that</p>
        <p className="empty__body">
          Try a word or phrase you would expect to see in the document itself. Only the folders you
          have indexed are searched.
        </p>
      </div>
    )
  }

  return (
    <div className="hits">
      {hits.map((hit) => (
        <HitRow
          key={hit.chunkId}
          hit={hit}
          selected={hit.chunkId === activeChunkId}
          onPick={onPickSource}
        />
      ))}
    </div>
  )
}
