import { useEffect, useRef, useState } from 'react'

import type { TwigraphConfig } from '@twigraph/shared'
import type { EngineStatus, IndexProgressEvent, PrivacyStatus } from '@twigraph/shared/ipc'

import { describeIndexProgress } from '../view-model'

export interface StatusBarProps {
  readonly engine: EngineStatus | null
  readonly privacy: PrivacyStatus | null
  readonly settings: TwigraphConfig | null
  readonly progress: IndexProgressEvent | null
  readonly offline: boolean
  readonly theme: 'system' | 'light' | 'dark'
  readonly onSetOffline: (offline: boolean) => void
  readonly onSetTheme: (theme: 'system' | 'light' | 'dark') => void
}

export function StatusBar({
  engine,
  privacy,
  settings,
  progress,
  offline,
  theme,
  onSetOffline,
  onSetTheme,
}: StatusBarProps) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog === null) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  const close = (): void => {
    setOpen(false)
    window.setTimeout(() => triggerRef.current?.focus(), 0)
  }

  return (
    <footer className="status">
      {progress === null ? null : <Progress progress={progress} />}
      <span className="status__badge">
        <span className={`status__dot${offline ? ' status__dot--off' : ''}`} aria-hidden="true" />
        {engine?.llm.label ?? 'Starting'}
      </span>
      <span className="status__message" aria-live="polite">
        {progress === null ? privacy?.message : describeIndexProgress(progress)}
      </span>
      <span className="status__spacer" />
      <span className="status__path" title={engine?.storagePath}>
        {engine?.storagePath}
      </span>
      <button
        ref={triggerRef}
        type="button"
        className="button button--quiet"
        onClick={() => setOpen(true)}
      >
        Settings and privacy
      </button>

      <dialog
        ref={dialogRef}
        className="settings"
        aria-labelledby="settings-title"
        onCancel={() => setOpen(false)}
        onClose={() => setOpen(false)}
      >
        <div className="settings__head">
          <div>
            <span className="pane__eyebrow">Local configuration</span>
            <h2 id="settings-title">Settings and privacy</h2>
          </div>
          <button type="button" className="button button--quiet" onClick={close}>
            Close
          </button>
        </div>
        <dl className="settings__list">
          <div>
            <dt>Search</dt>
            <dd>Lexical BM25, fully offline</dd>
          </div>
          <div>
            <dt>Answers</dt>
            <dd>{engine?.llm.label ?? 'Extractive (Local)'}</dd>
          </div>
          <div>
            <dt>Local model</dt>
            <dd>
              {engine?.llm.available === true && engine.llm.provider !== 'extractive'
                ? 'Available'
                : 'Not in this build'}
            </dd>
          </div>
          <div>
            <dt>Embeddings</dt>
            <dd>{engine?.embeddings.available === true ? 'Ready' : 'Not in this build'}</dd>
          </div>
          <div>
            <dt>Indexed folders</dt>
            <dd>{settings === null ? '—' : settings.folders.length}</dd>
          </div>
        </dl>
        <fieldset className="theme-setting">
          <legend>Theme</legend>
          <label>
            <input
              type="radio"
              name="theme"
              value="system"
              checked={theme === 'system'}
              onChange={() => onSetTheme('system')}
            />
            <span>System</span>
          </label>
          <label>
            <input
              type="radio"
              name="theme"
              value="light"
              checked={theme === 'light'}
              onChange={() => onSetTheme('light')}
            />
            <span>Light</span>
          </label>
          <label>
            <input
              type="radio"
              name="theme"
              value="dark"
              checked={theme === 'dark'}
              onChange={() => onSetTheme('dark')}
            />
            <span>Dark</span>
          </label>
        </fieldset>
        <label className="offline-setting">
          <span>
            <strong>Offline mode</strong>
            <small>Refuse every network destination when network features arrive.</small>
          </span>
          <input
            type="checkbox"
            checked={offline}
            onChange={(event) => onSetOffline(event.target.checked)}
          />
        </label>
        <p className="settings__note">
          Nothing in this build makes a network request, whether offline mode is on or off. Local
          embeddings and a local language model are not in this build.
        </p>
        <p className="settings__note">
          Removing a folder deletes its index. Removing all twigraph data remains a CLI operation:{' '}
          <code>twigraph delete --all</code>
        </p>
      </dialog>
    </footer>
  )
}

function Progress({ progress }: { readonly progress: IndexProgressEvent }) {
  const total = progress.documentsTotal === 0 ? 1 : progress.documentsTotal
  const filled = Math.min(100, Math.round((progress.documentsProcessed / total) * 100))

  return (
    <div
      className="progress"
      role="progressbar"
      aria-label="Indexing progress"
      aria-valuenow={progress.documentsProcessed}
      aria-valuemax={progress.documentsTotal}
    >
      <div className="progress__fill" style={{ width: `${filled}%` }} />
    </div>
  )
}
