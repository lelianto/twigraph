import type { Answer, AnswerProviderId, SearchOptions, SearchResult } from './contracts/answer'
import type { DocumentFailure } from './contracts/document'
import type { IndexManifest } from './contracts/stores'
import type { TwigraphConfig } from './config'
import type { WireError } from './errors'

/**
 * The IPC surface.
 *
 * The renderer has no filesystem and no network access. Everything it can do is a named
 * channel here — there is deliberately no generic `invoke(channel, ...)` passthrough, so
 * the reachable surface is exactly this list.
 */

export const IPC_CHANNELS = {
  foldersList: 'folders:list',
  foldersAdd: 'folders:add',
  foldersRemove: 'folders:remove',
  indexStart: 'index:start',
  indexCancel: 'index:cancel',
  indexStatus: 'index:status',
  searchQuery: 'search:query',
  askQuestion: 'ask:question',
  sourceOpen: 'source:open',
  sourceReveal: 'source:reveal',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  privacyStatus: 'privacy:status',
  engineStatus: 'engine:status',
  modelPrepare: 'model:prepare',
  llmSetProvider: 'llm:set-provider',
} as const

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS]

/** Main to renderer. */
export const IPC_EVENTS = {
  indexProgress: 'index:progress',
  indexError: 'index:error',
  indexDone: 'index:done',
  askChunk: 'ask:chunk',
} as const

export type IpcEvent = (typeof IPC_EVENTS)[keyof typeof IPC_EVENTS]

export interface IpcOk<T> {
  readonly ok: true
  readonly value: T
}

export interface IpcFailure {
  readonly ok: false
  readonly error: WireError
}

/** Handlers return this instead of throwing, so the renderer never sees a stack. */
export type IpcResult<T> = IpcOk<T> | IpcFailure

export interface FolderSummary {
  readonly id: string
  readonly path: string
  readonly addedAtMs: number
  readonly lastIndexedAtMs: number | null
  readonly documentCount: number
  readonly chunkCount: number
  readonly failedCount: number
  readonly indexSizeBytes: number
}

export type IndexPhase = 'scanning' | 'parsing' | 'chunking' | 'embedding' | 'writing'

export interface IndexProgressEvent {
  readonly folderId: string
  readonly phase: IndexPhase
  readonly documentsTotal: number
  readonly documentsProcessed: number
  readonly chunksWritten: number
  /** Path of the file being processed, or null between phases. */
  readonly currentFile: string | null
}

export interface IndexStatus {
  readonly running: boolean
  readonly folderId: string | null
}

export interface EmbeddingStatus {
  readonly available: boolean
  /** True once the model files are on disk and the last run could embed. */
  readonly prepared: boolean
  readonly enabled: boolean
  readonly modelId: string
  readonly label: string
}

export interface LlmStatus {
  readonly provider: AnswerProviderId
  readonly available: boolean
  readonly label: string
  readonly model: string | null
  /** Models Ollama reports as installed; never a hardcoded list. */
  readonly models: readonly string[]
}

export interface EngineStatus {
  readonly embeddings: EmbeddingStatus
  readonly llm: LlmStatus
  readonly storagePath: string
}

export const PRIVACY_MESSAGE = 'Your files stay on this device.'

export interface PrivacyStatus {
  readonly message: string
  readonly offline: boolean
  readonly engine: AnswerProviderId
  /** Every destination the app may currently reach. Empty under `offline`. */
  readonly allowedDestinations: readonly string[]
}

export interface SettingsPatch {
  readonly offline?: boolean
  readonly embeddings?: { readonly enabled?: boolean }
  readonly llm?: { readonly provider?: AnswerProviderId; readonly model?: string }
}

/**
 * The object `contextBridge` exposes as `window.twigraph`. Event subscriptions return their
 * own unsubscribe function so the renderer cannot leak listeners across a reload.
 */
export interface TwigraphApi {
  readonly folders: {
    list(): Promise<IpcResult<readonly FolderSummary[]>>
    add(): Promise<IpcResult<FolderSummary | null>>
    remove(folderId: string): Promise<IpcResult<void>>
  }
  readonly index: {
    start(folderId: string): Promise<IpcResult<void>>
    cancel(): Promise<IpcResult<void>>
    status(): Promise<IpcResult<IndexStatus>>
  }
  readonly search: {
    query(query: string, options?: SearchOptions): Promise<IpcResult<SearchResult>>
  }
  readonly ask: {
    question(query: string): Promise<IpcResult<Answer>>
  }
  readonly sources: {
    open(absolutePath: string): Promise<IpcResult<void>>
    reveal(absolutePath: string): Promise<IpcResult<void>>
  }
  readonly settings: {
    get(): Promise<IpcResult<TwigraphConfig>>
    set(patch: SettingsPatch): Promise<IpcResult<TwigraphConfig>>
  }
  readonly privacy: {
    status(): Promise<IpcResult<PrivacyStatus>>
  }
  readonly engine: {
    status(): Promise<IpcResult<EngineStatus>>
    prepareModel(): Promise<IpcResult<EmbeddingStatus>>
  }
  readonly llm: {
    setProvider(provider: AnswerProviderId, model?: string): Promise<IpcResult<LlmStatus>>
  }
  readonly on: {
    indexProgress(handler: (event: IndexProgressEvent) => void): () => void
    indexError(handler: (failure: DocumentFailure) => void): () => void
    indexDone(handler: (manifest: IndexManifest) => void): () => void
    askChunk(handler: (token: string) => void): () => void
  }
}
