import { useState } from 'react'

import type { EngineStatus, IndexProgressEvent, PrivacyStatus } from '@twigraph/shared/ipc'
import type { TwigraphConfig } from '@twigraph/shared'

import { describeIndexProgress } from '../view-model'

export interface StatusBarProps {
  readonly engine: EngineStatus | null
  readonly privacy: PrivacyStatus | null
  readonly settings: TwigraphConfig | null
  readonly progress: IndexProgressEvent | null
  readonly offline: boolean
  readonly onSetOffline: (offline: boolean) => void
}

/**
 * The one place that says what this app is doing with your machine: which engine answers,
 * whether a model is available, whether anything can be reached, and where the data is.
 *
 * It says "not in this build" for the parts that are not built yet rather than showing a
 * control that would do nothing.
 */
export function StatusBar({
  engine,
  privacy,
  settings,
  progress,
  offline,
  onSetOffline,
}: StatusBarProps) {
  const [open, setOpen] = useState(false)

  return (
    <footer className="status">
      {progress === null ? null : <Progress progress={progress} />}

      <span className="status__badge">
        <span className={`status__dot${offline ? ' status__dot--off' : ''}`} aria-hidden="true" />
        {engine?.llm.label ?? 'Starting…'}
      </span>

      <span aria-live="polite">
        {progress === null ? privacy?.message : describeIndexProgress(progress)}
      </span>

      <span className="status__spacer" />

      <span className="status__path" title={engine?.storagePath}>
        {engine?.storagePath}
      </span>

      <button
        type="button"
        className="button button--quiet"
        onClick={() => setOpen((value) => !value)}
      >
        {open ? 'Close' : 'Settings'}
      </button>

      {open ? (
        <SettingsPanel
          engine={engine}
          settings={settings}
          offline={offline}
          onSetOffline={onSetOffline}
        />
      ) : null}
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
      aria-valuenow={progress.documentsProcessed}
      aria-valuemax={progress.documentsTotal}
    >
      <div className="progress__fill" style={{ width: `${filled}%` }} />
    </div>
  )
}

interface SettingsPanelProps {
  readonly engine: EngineStatus | null
  readonly settings: TwigraphConfig | null
  readonly offline: boolean
  readonly onSetOffline: (offline: boolean) => void
}

function SettingsPanel({ engine, settings, offline, onSetOffline }: SettingsPanelProps) {
  return (
    <div className="settings">
      <p className="settings__title">This build</p>

      <div className="settings__row">
        <span className="settings__label">Search</span>
        <span className="settings__value">Lexical (BM25) — runs offline, needs no model</span>
      </div>

      <div className="settings__row">
        <span className="settings__label">Answers</span>
        <span className="settings__value">{engine?.llm.label ?? 'Extractive (Local)'}</span>
      </div>

      <div className="settings__row">
        <span className="settings__label">Local model</span>
        <span className="settings__value settings__value--off">
          {engine?.llm.available === true && engine.llm.provider !== 'extractive'
            ? 'Available'
            : 'Not in this build'}
        </span>
      </div>

      <div className="settings__row">
        <span className="settings__label">Embeddings</span>
        <span className="settings__value settings__value--off">
          {engine?.embeddings.available === true ? 'Ready' : 'Not in this build'}
        </span>
      </div>

      <div className="settings__row">
        <span className="settings__label">Offline mode</span>
        <span className="settings__value">
          <button
            type="button"
            className={`button ${offline ? 'button--primary' : ''}`}
            onClick={() => onSetOffline(!offline)}
          >
            {offline ? 'On — nothing may be reached' : 'Off'}
          </button>
        </span>
      </div>

      <div className="settings__row">
        <span className="settings__label">Indexed folders</span>
        <span className="settings__value">
          {settings === null ? '—' : `${settings.folders.length}`}
        </span>
      </div>

      <p className="settings__note">
        Nothing in this build makes a network request, whether or not offline mode is on. There is
        no embedding model to download and no language model to reach, so the flag has nothing to
        refuse yet — it is recorded in your config either way.
      </p>

      <p className="settings__note">
        Removing a folder here deletes its index with it. Removing everything twigraph stores,
        including its config, is still the command line&apos;s job:
        <br />
        <code>twigraph delete --all</code>
      </p>
    </div>
  )
}
