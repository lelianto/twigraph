import { useCallback, useEffect, useRef, useState } from 'react'

import type { Answer, SearchResult, TwigraphConfig } from '@twigraph/shared'
import type {
  EngineStatus,
  FolderSummary,
  IndexProgressEvent,
  PrivacyStatus,
} from '@twigraph/shared/ipc'

import { AnswerLedger, SearchHits } from './components/AnswerLedger'
import { FolderRail } from './components/FolderRail'
import { SourceInspector } from './components/SourceInspector'
import type { SelectedSource } from './components/SourceInspector'
import { StatusBar } from './components/StatusBar'
import { citationFor, folderName, resultStatus, workspacePhase } from './view-model'

type Mode = 'search' | 'ask'
type ThemePreference = 'system' | 'light' | 'dark'

function initialTheme(): ThemePreference {
  const saved = localStorage.getItem('twigraph-theme')
  return saved === 'light' || saved === 'dark' ? saved : 'system'
}

/** Long enough to notice the counts settle, short enough not to sit on a finished screen. */
const SETTLE_MS = 1000

export function App() {
  const [folders, setFolders] = useState<readonly FolderSummary[]>([])
  const [engine, setEngine] = useState<EngineStatus | null>(null)
  const [privacy, setPrivacy] = useState<PrivacyStatus | null>(null)
  const [settings, setSettings] = useState<TwigraphConfig | null>(null)

  const [mode, setMode] = useState<Mode>('ask')
  const [theme, setTheme] = useState<ThemePreference>(initialTheme)
  const [query, setQuery] = useState('')
  const [result, setResult] = useState<SearchResult | null>(null)
  const [answer, setAnswer] = useState<Answer | null>(null)

  const [selected, setSelected] = useState<SelectedSource | null>(null)
  const [activeMarker, setActiveMarker] = useState<number | null>(null)
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null)

  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<IndexProgressEvent | null>(null)
  const [indexingFolderId, setIndexingFolderId] = useState<string | null>(null)
  const [settledFolderId, setSettledFolderId] = useState<string | null>(null)

  const [error, setError] = useState<string | null>(null)
  const [notes, setNotes] = useState<readonly string[]>([])
  const [nowMs, setNowMs] = useState(() => Date.now())

  const settleTimer = useRef<number | null>(null)
  const sourceTrigger = useRef<HTMLElement | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    const [folderList, engineStatus, privacyStatus, config] = await Promise.all([
      window.twigraph.folders.list(),
      window.twigraph.engine.status(),
      window.twigraph.privacy.status(),
      window.twigraph.settings.get(),
    ])

    if (folderList.ok) setFolders(folderList.value)
    if (engineStatus.ok) setEngine(engineStatus.value)
    if (privacyStatus.ok) setPrivacy(privacyStatus.value)
    if (config.ok) setSettings(config.value)
    setNowMs(Date.now())
  }, [])

  useEffect(() => {
    if (theme === 'system') {
      document.documentElement.removeAttribute('data-theme')
      localStorage.removeItem('twigraph-theme')
    } else {
      document.documentElement.dataset.theme = theme
      localStorage.setItem('twigraph-theme', theme)
    }
  }, [theme])

  useEffect(() => {
    void refresh()

    const offProgress = window.twigraph.on.indexProgress((event) => {
      setProgress(event)
      setIndexingFolderId(event.folderId)
    })

    const offError = window.twigraph.on.indexError((failure) => {
      // Every file the run could not read, named, rather than one silent gap.
      setNotes((current) => [...current, `${failure.relativePath}  ${failure.message}`])
    })

    const offDone = window.twigraph.on.indexDone((manifest) => {
      setProgress(null)
      setIndexingFolderId(null)
      setSettledFolderId(manifest.folderId)
      if (settleTimer.current !== null) window.clearTimeout(settleTimer.current)
      settleTimer.current = window.setTimeout(() => {
        setSettledFolderId(null)
      }, SETTLE_MS)
      void refresh()
    })

    return () => {
      offProgress()
      offError()
      offDone()
    }
  }, [refresh])

  const addFolder = async (): Promise<void> => {
    setError(null)
    const added = await window.twigraph.folders.add()
    if (!added.ok) {
      setError(added.error.message)
      return
    }
    if (added.value !== null) setActiveFolderId(added.value.id)
    await refresh()
  }

  const removeFolder = async (folderId: string): Promise<void> => {
    setError(null)
    const removed = await window.twigraph.folders.remove(folderId)
    if (!removed.ok) {
      setError(removed.error.message)
      return
    }
    if (activeFolderId === folderId) setActiveFolderId(null)
    setAnswer(null)
    setResult(null)
    setSelected(null)
    await refresh()
  }

  const startIndex = async (folderId: string): Promise<void> => {
    setError(null)
    setNotes([])
    setActiveFolderId(folderId)
    setIndexingFolderId(folderId)
    const started = await window.twigraph.index.start(folderId)
    setIndexingFolderId(null)
    setProgress(null)
    // A run the user cancelled is not an error to report back to them.
    if (!started.ok && started.error.code !== 'CANCELLED') setError(started.error.message)
    await refresh()
  }

  const runQuery = async (): Promise<void> => {
    const asked = query.trim()
    if (asked === '') return

    setBusy(true)
    setError(null)
    setSelected(null)
    setActiveMarker(null)

    if (mode === 'ask') {
      const response = await window.twigraph.ask.question(asked)
      setAnswer(response.ok ? response.value : null)
      setResult(null)
      if (!response.ok) setError(response.error.message)
    } else {
      const response = await window.twigraph.search.query(asked)
      setResult(response.ok ? response.value : null)
      setAnswer(null)
      if (!response.ok) setError(response.error.message)
    }

    setBusy(false)
  }

  const rememberSourceTrigger = (): void => {
    sourceTrigger.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
  }

  const closeSource = (): void => {
    setSelected(null)
    setActiveMarker(null)
    window.setTimeout(() => sourceTrigger.current?.focus(), 0)
  }

  const pickMarker = (marker: number): void => {
    if (answer === null) return
    rememberSourceTrigger()
    if (activeMarker === marker) {
      setActiveMarker(null)
      setSelected(null)
      return
    }
    setActiveMarker(marker)

    const citation = citationFor(answer, marker)
    if (citation === undefined) return
    const hit = answer.sources.find((source) => source.chunkId === citation.chunkId)
    if (hit !== undefined) setSelected({ hit, marker })
  }

  const pickSource = (hit: Answer['sources'][number]): void => {
    rememberSourceTrigger()
    setActiveMarker(null)
    setSelected({ hit, marker: null })
  }

  const openSource = async (absolutePath: string): Promise<void> => {
    const opened = await window.twigraph.sources.open(absolutePath)
    if (!opened.ok) setError(opened.error.message)
  }

  const revealSource = async (absolutePath: string): Promise<void> => {
    const revealed = await window.twigraph.sources.reveal(absolutePath)
    if (!revealed.ok) setError(revealed.error.message)
  }

  const setOffline = async (offline: boolean): Promise<void> => {
    const saved = await window.twigraph.settings.set({ offline })
    if (!saved.ok) {
      setError(saved.error.message)
      return
    }
    setSettings(saved.value)
    const status = await window.twigraph.privacy.status()
    if (status.ok) setPrivacy(status.value)
  }

  const offline = privacy?.offline ?? false
  const activeFolder = folders.find((folder) => folder.id === activeFolderId) ?? folders[0] ?? null
  const phase = workspacePhase({ folders, activeFolderId, answer, result })
  const canQuery = folders.some((folder) => folder.lastIndexedAtMs !== null)
  const announcement = busy
    ? mode === 'ask'
      ? 'Building an answer.'
      : 'Searching indexed files.'
    : resultStatus({ answer, result })

  const selectFolder = (folderId: string): void => {
    setActiveFolderId(folderId)
    setAnswer(null)
    setResult(null)
    setSelected(null)
    setActiveMarker(null)
  }

  return (
    <div className="app">
      <FolderRail
        folders={folders}
        nowMs={nowMs}
        indexingFolderId={indexingFolderId}
        selectedFolderId={activeFolder?.id ?? null}
        settledFolderId={settledFolderId}
        onSelect={selectFolder}
        onAdd={() => void addFolder()}
        onIndex={(folderId) => void startIndex(folderId)}
        onCancel={() => void window.twigraph.index.cancel()}
        onRemove={(folderId) => void removeFolder(folderId)}
      />

      <main className="pane canvas" aria-busy={busy}>
        <form
          className="ask"
          onSubmit={(event) => {
            event.preventDefault()
            void runQuery()
          }}
        >
          <div className="ask__head">
            <label htmlFor="query">Ask or search your indexed files</label>
            <span id="mode-description">
              {mode === 'ask'
                ? 'Build an extractive answer with citations.'
                : 'List matching passages by relevance.'}
            </span>
          </div>
          <div className="ask__row">
            <input
              id="query"
              className="ask__input"
              type="text"
              value={query}
              placeholder={
                mode === 'ask'
                  ? 'Example: How are indexes replaced safely?'
                  : 'Example: atomic index writes'
              }
              aria-describedby="mode-description query-help"
              onChange={(event) => setQuery(event.target.value)}
            />
            <div className="ask__modes" role="group" aria-label="Query mode">
              <button
                type="button"
                className={`mode${mode === 'ask' ? ' mode--on' : ''}`}
                aria-pressed={mode === 'ask'}
                onClick={() => setMode('ask')}
              >
                Ask
              </button>
              <button
                type="button"
                className={`mode${mode === 'search' ? ' mode--on' : ''}`}
                aria-pressed={mode === 'search'}
                onClick={() => setMode('search')}
              >
                Search
              </button>
            </div>
            <button type="submit" className="button button--primary" disabled={busy || !canQuery}>
              {mode === 'ask' ? 'Ask files' : 'Search files'}
            </button>
          </div>
          <p id="query-help" className="ask__help">
            {canQuery
              ? 'Press Enter to run the query.'
              : 'Add and index a folder before running a query.'}
          </p>
        </form>

        <div className="sr-only" role="status" aria-live="polite">
          {announcement}
        </div>

        {error === null ? null : (
          <div className="banner banner--error" role="alert">
            <span>{error}</span>
            <button type="button" className="button button--quiet" onClick={() => setError(null)}>
              Dismiss
            </button>
          </div>
        )}

        {notes.length === 0 ? null : (
          <div className="notes" role="status">
            <strong>
              {notes.length} file{notes.length === 1 ? '' : 's'} could not be read
            </strong>
            {notes.map((note) => (
              <div key={note}>{note}</div>
            ))}
          </div>
        )}

        <div className="canvas__content">
          {phase === 'no-folders' ? (
            <div className="workspace-state workspace-state--first-run">
              <span className="workspace-state__step">Start here</span>
              <h1>Bring one folder into view</h1>
              <p>
                twigraph builds a local index, answers only from what it finds, and keeps every
                result connected to its source.
              </p>
              <ol>
                <li>
                  <span>1</span>Add a folder
                </li>
                <li>
                  <span>2</span>Build its index
                </li>
                <li>
                  <span>3</span>Ask and inspect sources
                </li>
              </ol>
              <button
                type="button"
                className="button button--primary"
                onClick={() => void addFolder()}
              >
                Add a folder
              </button>
              <small>Your files stay on this device. No account or upload.</small>
            </div>
          ) : phase === 'needs-index' && activeFolder !== null ? (
            <div className="workspace-state">
              <span className="workspace-state__step">Folder added</span>
              <h1>Build the first index</h1>
              <p>
                <strong>{folderName(activeFolder.path)}</strong> is ready. Indexing reads supported
                files and writes a searchable local index without changing the originals.
              </p>
              <button
                type="button"
                className="button button--primary"
                onClick={() => void startIndex(activeFolder.id)}
              >
                Index this folder
              </button>
            </div>
          ) : answer !== null ? (
            <AnswerLedger
              answer={answer}
              activeMarker={activeMarker}
              activeChunkId={selected?.hit.chunkId ?? null}
              onPickMarker={pickMarker}
              onPickSource={pickSource}
            />
          ) : result !== null ? (
            <SearchHits
              hits={result.hits}
              activeChunkId={selected?.hit.chunkId ?? null}
              onPickSource={pickSource}
            />
          ) : (
            <div className="workspace-state">
              <span className="workspace-state__step">Ready</span>
              <h1>Ask what your files say</h1>
              <p>
                Use Ask for a concise extractive answer with citations, or Search to inspect ranked
                passages directly.
              </p>
              <div className="workspace-state__examples">
                <span>Try asking</span>
                <button type="button" onClick={() => setQuery('How are indexes replaced safely?')}>
                  How are indexes replaced safely?
                </button>
                <button
                  type="button"
                  onClick={() => setQuery('What happens when retrieval is weak?')}
                >
                  What happens when retrieval is weak?
                </button>
              </div>
            </div>
          )}
        </div>
      </main>

      <SourceInspector
        source={selected}
        onClose={closeSource}
        onOpen={(absolutePath) => void openSource(absolutePath)}
        onReveal={(absolutePath) => void revealSource(absolutePath)}
      />

      <StatusBar
        engine={engine}
        privacy={privacy}
        settings={settings}
        progress={progress}
        offline={offline}
        theme={theme}
        onSetOffline={(value) => void setOffline(value)}
        onSetTheme={setTheme}
      />
    </div>
  )
}
