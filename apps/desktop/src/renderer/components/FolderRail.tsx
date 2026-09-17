import { useState } from 'react'

import type { FolderSummary } from '@twigraph/shared/ipc'

import { folderName, folderStateLine, formatWhen } from '../view-model'

export interface FolderRailProps {
  readonly folders: readonly FolderSummary[]
  readonly nowMs: number
  readonly indexingFolderId: string | null
  readonly selectedFolderId: string | null
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
    <aside className="pane pane--rail" aria-labelledby="folders-heading">
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

      <div className="rail__heading">
        <h2 id="folders-heading">Folders</h2>
        <span>{folders.length}</span>
      </div>

      <div className="rail__list">
        {folders.length === 0 ? (
          <p className="rail__empty">Folders you add will appear here.</p>
        ) : (
          <ul>
            {folders.map((folder) => (
              <FolderRow
                key={folder.id}
                folder={folder}
                nowMs={nowMs}
                selected={folder.id === selectedFolderId}
                indexing={folder.id === indexingFolderId}
                settled={folder.id === settledFolderId}
                onSelect={onSelect}
                onIndex={onIndex}
                onCancel={onCancel}
                onRemove={onRemove}
              />
            ))}
          </ul>
        )}
      </div>

      {folders.length === 0 ? null : (
        <div className="rail__foot">
          <button type="button" className="button button--wide" onClick={onAdd}>
            Add another folder
          </button>
        </div>
      )}
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
  const stateId = `folder-${folder.id}-state`

  return (
    <li className={`folder${selected ? ' folder--on' : ''}${indexing ? ' folder--indexing' : ''}`}>
      <button
        type="button"
        className="folder__select"
        aria-pressed={selected}
        aria-describedby={stateId}
        onClick={() => onSelect(folder.id)}
      >
        <span className="folder__name">{folderName(folder.path)}</span>
        <span className="folder__path" title={folder.path}>
          {folder.path}
        </span>
        <span id={stateId} className={`folder__state${settled ? ' folder__state--settle' : ''}`}>
          {indexing ? 'Indexing now' : folderStateLine(folder)}
        </span>
        <span className="folder__when">{formatWhen(folder.lastIndexedAtMs, nowMs)}</span>
      </button>

      {confirming ? (
        <div
          className="folder__confirm"
          role="group"
          aria-label={`Remove ${folderName(folder.path)}`}
        >
          <p>Remove this folder and delete its index?</p>
          <div className="folder__actions">
            <button
              type="button"
              className="button button--danger"
              onClick={() => {
                setConfirming(false)
                onRemove(folder.id)
              }}
            >
              Remove folder
            </button>
            <button
              type="button"
              className="button button--quiet"
              autoFocus
              onClick={() => setConfirming(false)}
            >
              Keep folder
            </button>
          </div>
        </div>
      ) : (
        <div className="folder__actions">
          <button
            type="button"
            className="button button--quiet"
            onClick={() => (indexing ? onCancel() : onIndex(folder.id))}
          >
            {indexing
              ? 'Cancel indexing'
              : folder.lastIndexedAtMs === null
                ? 'Index folder'
                : 'Re-index'}
          </button>
          <button
            type="button"
            className="button button--danger"
            onClick={() => setConfirming(true)}
          >
            Remove
          </button>
        </div>
      )}
    </li>
  )
}
