import { IPC_CHANNELS, IPC_EVENTS } from '@twigraph/shared/ipc'
import type {
  EmbeddingStatus,
  EngineStatus,
  FolderSummary,
  IndexProgressEvent,
  IndexStatus,
  IpcChannel,
  IpcEvent,
  IpcResult,
  LlmStatus,
  PrivacyStatus,
  SettingsPatch,
  TwigraphApi,
} from '@twigraph/shared/ipc'
import type {
  Answer,
  DocumentFailure,
  IndexManifest,
  SearchOptions,
  SearchResult,
  TwigraphConfig,
} from '@twigraph/shared'

/**
 * The one thing the preload needs from Electron, described structurally so a test can pass
 * a plain object instead of a real `ipcRenderer`.
 */
export interface IpcRendererLike {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>
  on(channel: string, listener: (event: unknown, ...args: unknown[]) => void): void
  removeListener(channel: string, listener: (event: unknown, ...args: unknown[]) => void): void
}

type Listener = (event: unknown, ...args: unknown[]) => void

/**
 * The object exposed to the renderer as `window.twigraph`.
 *
 * Every method names one channel from the frozen contract. There is no generic
 * `invoke(channel, …)` here on purpose: with no passthrough, the renderer's reachable
 * surface is exactly the list in `ipc.ts`, whatever the renderer tries to call.
 */
export function createTwigraphApi(ipcRenderer: IpcRendererLike): TwigraphApi {
  const invoke = <T>(channel: IpcChannel, ...args: readonly unknown[]): Promise<IpcResult<T>> =>
    ipcRenderer.invoke(channel, ...args) as Promise<IpcResult<T>>

  /**
   * Electron hands a listener the event object first. The renderer only ever wants the
   * payload, and the unsubscribe closes over the same listener instance so removing it
   * cannot miss.
   */
  const subscribe = <T>(channel: IpcEvent, handler: (payload: T) => void): (() => void) => {
    const listener: Listener = (_event, payload) => {
      handler(payload as T)
    }
    ipcRenderer.on(channel, listener)
    return () => {
      ipcRenderer.removeListener(channel, listener)
    }
  }

  return {
    folders: {
      list: () => invoke<readonly FolderSummary[]>(IPC_CHANNELS.foldersList),
      add: () => invoke<FolderSummary | null>(IPC_CHANNELS.foldersAdd),
      remove: (folderId) => invoke<void>(IPC_CHANNELS.foldersRemove, folderId),
    },
    index: {
      start: (folderId) => invoke<void>(IPC_CHANNELS.indexStart, folderId),
      cancel: () => invoke<void>(IPC_CHANNELS.indexCancel),
      status: () => invoke<IndexStatus>(IPC_CHANNELS.indexStatus),
    },
    search: {
      query: (query: string, options?: SearchOptions) =>
        options === undefined
          ? invoke<SearchResult>(IPC_CHANNELS.searchQuery, query)
          : invoke<SearchResult>(IPC_CHANNELS.searchQuery, query, options),
    },
    ask: {
      question: (query) => invoke<Answer>(IPC_CHANNELS.askQuestion, query),
    },
    sources: {
      open: (absolutePath) => invoke<void>(IPC_CHANNELS.sourceOpen, absolutePath),
      reveal: (absolutePath) => invoke<void>(IPC_CHANNELS.sourceReveal, absolutePath),
    },
    settings: {
      get: () => invoke<TwigraphConfig>(IPC_CHANNELS.settingsGet),
      set: (patch: SettingsPatch) => invoke<TwigraphConfig>(IPC_CHANNELS.settingsSet, patch),
    },
    privacy: {
      status: () => invoke<PrivacyStatus>(IPC_CHANNELS.privacyStatus),
    },
    engine: {
      status: () => invoke<EngineStatus>(IPC_CHANNELS.engineStatus),
      prepareModel: () => invoke<EmbeddingStatus>(IPC_CHANNELS.modelPrepare),
    },
    llm: {
      setProvider: (provider, model) =>
        model === undefined
          ? invoke<LlmStatus>(IPC_CHANNELS.llmSetProvider, provider)
          : invoke<LlmStatus>(IPC_CHANNELS.llmSetProvider, provider, model),
    },
    on: {
      indexProgress: (handler) => subscribe<IndexProgressEvent>(IPC_EVENTS.indexProgress, handler),
      indexError: (handler) => subscribe<DocumentFailure>(IPC_EVENTS.indexError, handler),
      indexDone: (handler) => subscribe<IndexManifest>(IPC_EVENTS.indexDone, handler),
      askChunk: (handler) => subscribe<string>(IPC_EVENTS.askChunk, handler),
    },
  }
}
