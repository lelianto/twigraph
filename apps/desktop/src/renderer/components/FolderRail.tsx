import { useState } from 'react'

import type { FolderSummary } from '@twigraph/shared/ipc'

import { folderName, folderStateLine, formatWhen } from '../view-model'

export interface FolderRailProps {
  readonly folders: readonly FolderSummary[]
  readonly nowMs: number
  /** The folder being indexed right now, if any. */
  readonly indexingFolderId: string | null
  readonly selectedFolderId: string | null
  /** Set briefly after a run finishes, so the counts can settle. */
  readonly settledFolderId: string | null
  readonly onSelect: (folderId: string) => void
  readonly onAdd: () => void
  readonly onIndex: (folderId: string) => void
  readonly onCancel: () => void
  readonly onRemove: (folderId: string) => void
}

export function FolderRail({
  folders,
  nowMs,
  indexingFolderId,
  selectedFolderId,
  settledFolderId,
  onSelect,
  onAdd,
  onIndex,
  onCancel,
  onRemove,
}: FolderRailProps) {
  return (
    <aside className="pane pane--rail">
      <div className="rail__brand">
        <svg className="rail__mark" viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M12 3v18M12 9l5-4M12 15l-5-4M12 6l-4-3M12 18l4-3"
            fill="none"
            stroke="var(--green)"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
        <span>twigraph</span>
      </div>

      <div className="rail__list">
        {folders.length === 0 ? (
          <p className="empty__body" style={{ padding: '8px 8px 0' }}>
            No folders yet. Add one, then index it.
          </p>
        ) : (
          folders.map((folder) => {
            const indexing = folder.id === indexingFolderId
            return (
              <FolderRow
                key={folder.id}
                folder={folder}
                nowMs={nowMs}
                selected={folder.id === selectedFolderId}
                indexing={indexing}
                settled={folder.id === settledFolderId}
                onSelect={onSelect}
                onIndex={onIndex}
                onCancel={onCancel}
                onRemove={onRemove}
              />
            )
          })
        )}
      </div>

      <div className="rail__foot">
        <button type="button" className="button button--wide" onClick={onAdd}>
          Add folder
        </button>
      </div>
    </aside>
  )
}

interface FolderRowProps {
  readonly folder: FolderSummary
  readonly nowMs: number
  readonly selected: boolean
  readonly indexing: boolean
  readonly settled: boolean
  readonly onSelect: (folderId: string) => void
  readonly onIndex: (folderId: string) => void
  readonly onCancel: () => void
  readonly onRemove: (folderId: string) => void
}

function FolderRow({
  folder,
  nowMs,
  selected,
  indexing,
  settled,
  onSelect,
  onIndex,
  onCancel,
  onRemove,
}: FolderRowProps) {
  const [confirming, setConfirming] = useState(false)

  const className = ['folder', selected ? 'folder--on' : '', indexing ? 'folder--indexing' : '']
    .filter((name) => name !== '')
    .join(' ')

  return (
    <div className={className} onClick={() => onSelect(folder.id)}>
      <span className="folder__name">{folderName(folder.path)}</span>
      {/* One line, with the full path on hover: a Windows path wraps to three lines and buries
          the counts, which are what a person is actually scanning for. */}
      <span className="folder__path" title={folder.path}>
        {folder.path}
      </span>
      <span className={`folder__state${settled ? ' folder__state--settle' : ''}`}>
        {indexing ? 'Indexing now…' : folderStateLine(folder)}
      </span>
      <span className="folder__state">{formatWhen(folder.lastIndexedAtMs, nowMs)}</span>

      {confirming ? (
        <div className="folder__actions" style={{ opacity: 1 }}>
          <button
            type="button"
            className="button button--danger"
            onClick={(event) => {
              event.stopPropagation()
              setConfirming(false)
              onRemove(folder.id)
            }}
          >
            Remove and delete its index
          </button>
          <button
            type="button"
            className="button button--quiet"
            onClick={(event) => {
              event.stopPropagation()
              setConfirming(false)
            }}
          >
            Keep
          </button>
        </div>
      ) : (
        <div className="folder__actions">
          {indexing ? (
            <button
              type="button"
              className="button button--quiet"
              onClick={(event) => {
                event.stopPropagation()
                onCancel()
              }}
            >
              Cancel
            </button>
          ) : (
            <button
              type="button"
              className="button button--quiet"
              onClick={(event) => {
                event.stopPropagation()
                onIndex(folder.id)
              }}
            >
              {folder.lastIndexedAtMs === null ? 'Index now' : 'Index again'}
            </button>
          )}
          <button
            type="button"
            className="button button--danger"
            onClick={(event) => {
              event.stopPropagation()
              setConfirming(true)
            }}
          >
            Remove
          </button>
        </div>
      )}
    </div>
  )
}
