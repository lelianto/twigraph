import type { Answer, SearchHit } from '@twigraph/shared'

import {
  accessibleHitLabel,
  answerLines,
  formatScore,
  groupAnswerSources,
  hitHeading,
  hitPageRange,
} from '../view-model'

export interface AnswerLedgerProps {
  readonly answer: Answer
  readonly activeMarker: number | null
  readonly activeChunkId: string | null
  readonly onPickMarker: (marker: number) => void
  readonly onPickSource: (hit: SearchHit) => void
}

export function AnswerLedger({
  answer,
  activeMarker,
  activeChunkId,
  onPickMarker,
  onPickSource,
}: AnswerLedgerProps) {
  const lines = answerLines(answer.text)
  const grouped = groupAnswerSources(answer)
  const picking = activeMarker !== null

  return (
    <div className="ledger">
      <header className="result-head">
        <div>
          <span className={`result-state result-state--${answer.status}`}>
            {answer.status === 'answered' ? 'Grounded answer' : 'No reliable answer'}
          </span>
          <h1>
            {answer.status === 'answered' ? 'Answer' : 'Nothing was strong enough to answer from'}
          </h1>
        </div>
        <p>
          {answer.status === 'answered'
            ? `${answer.citations.length} cited source${answer.citations.length === 1 ? '' : 's'}`
            : `${answer.sources.length} closest passage${answer.sources.length === 1 ? '' : 's'}`}
        </p>
      </header>

      {answer.status === 'insufficient' ? (
        <p className="ledger__insufficient">{answer.text}</p>
      ) : null}
      {answer.note === undefined ? null : <p className="ledger__note">{answer.note}</p>}
      {answer.unverifiedMarkers.length === 0 ? null : (
        <p className="ledger__note">
          {answer.unverifiedMarkers.length} unsupported marker
          {answer.unverifiedMarkers.length === 1 ? ' was' : 's were'} removed because no retrieved
          passage backed them.
        </p>
      )}

      {answer.status === 'answered' ? (
        <section className="answer-section" aria-labelledby="answer-heading">
          <h2 id="answer-heading" className="section-label">
            Quoted answer
          </h2>
          <div className={picking ? 'ledger__lines ledger__lines--picking' : 'ledger__lines'}>
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
                        aria-label={`Inspect source ${marker}`}
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
        </section>
      ) : null}

      {grouped.cited.length === 0 ? null : (
        <EvidenceSection
          title="Sources used"
          hits={grouped.cited}
          activeChunkId={activeChunkId}
          onPickSource={onPickSource}
        />
      )}
      {grouped.additional.length === 0 ? null : (
        <EvidenceSection
          title="Other retrieved passages"
          hits={grouped.additional}
          activeChunkId={activeChunkId}
          onPickSource={onPickSource}
        />
      )}
      {answer.status === 'insufficient' && answer.sources.length > 0 ? (
        <EvidenceSection
          title="Closest passages"
          hits={answer.sources}
          activeChunkId={activeChunkId}
          onPickSource={onPickSource}
        />
      ) : null}
    </div>
  )
}

function EvidenceSection({
  title,
  hits,
  activeChunkId,
  onPickSource,
}: {
  readonly title: string
  readonly hits: readonly SearchHit[]
  readonly activeChunkId: string | null
  readonly onPickSource: (hit: SearchHit) => void
}) {
  return (
    <section className="evidence-section">
      <h2 className="section-label">{title}</h2>
      <div className="hit-list">
        {hits.map((hit) => (
          <HitRow
            key={hit.chunkId}
            hit={hit}
            selected={hit.chunkId === activeChunkId}
            onPick={onPickSource}
          />
        ))}
      </div>
    </section>
  )
}

export interface HitRowProps {
  readonly hit: SearchHit
  readonly selected: boolean
  readonly onPick: (hit: SearchHit) => void
}

export function HitRow({ hit, selected, onPick }: HitRowProps) {
  const heading = hitHeading(hit)
  const page = hitPageRange(hit)

  return (
    <button
      type="button"
      className={`hit${selected ? ' hit--on' : ''}`}
      aria-label={accessibleHitLabel(hit)}
      aria-pressed={selected}
      onClick={() => onPick(hit)}
    >
      <span className="hit__score">
        <small>Relevance</small>
        {formatScore(hit.score)}
      </span>
      <span className="hit__body">
        <span className="hit__name">{hit.filename}</span>
        {heading === null && page === null ? null : (
          <span className="hit__where">{[heading, page].filter(Boolean).join(' · ')}</span>
        )}
        <span className="hit__excerpt">{hit.excerpt}</span>
      </span>
      <span className="hit__inspect" aria-hidden="true">
        Inspect
      </span>
    </button>
  )
}

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
      <div className="workspace-state">
        <span className="workspace-state__step">No matches</span>
        <h1>Nothing matched that query</h1>
        <p>Try words you expect to appear in the document. Only indexed folders are searched.</p>
      </div>
    )
  }

  return (
    <div className="search-results">
      <header className="result-head">
        <div>
          <span className="result-state">Ranked passages</span>
          <h1>Search results</h1>
        </div>
        <p>
          {hits.length} match{hits.length === 1 ? '' : 'es'}
        </p>
      </header>
      <div className="hit-list">
        {hits.map((hit) => (
          <HitRow
            key={hit.chunkId}
            hit={hit}
            selected={hit.chunkId === activeChunkId}
            onPick={onPickSource}
          />
        ))}
      </div>
    </div>
  )
}
