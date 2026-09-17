import { stat } from 'node:fs/promises'

import { buildIndex } from '@twigraph/indexing'
import type { DataStore } from '@twigraph/indexing'
import { createExtractiveAnswerEngine, createRetriever, meetsConfidence } from '@twigraph/retrieval'
import {
  TwigraphError,
  canonicalFolderPath,
  loadConfig,
  parseConfig,
  saveConfig,
} from '@twigraph/shared'
import type {
  Answer,
  AnswerProviderId,
  ChunkRecord,
  DocumentRecord,
  FolderRecord,
  FolderRegistry,
  RetrievalSnapshot,
  SearchOptions,
  SearchResult,
  TwigraphConfig,
} from '@twigraph/shared'
import { IPC_EVENTS, PRIVACY_MESSAGE } from '@twigraph/shared/ipc'
import type {
  EmbeddingStatus,
  EngineStatus,
  FolderSummary,
  IndexProgressEvent,
  IndexStatus,
  IpcEvent,
  LlmStatus,
  PrivacyStatus,
  SettingsPatch,
} from '@twigraph/shared/ipc'

/**
 * Everything the desktop UI can do, as plain async methods on the engine.
 *
 * It deliberately imports nothing from Electron: the two impure things it needs — a folder
 * picker and a way to open a file in the user's shell — arrive as parameters. That is what
 * lets the whole desktop surface be tested without launching a window.
 *
 * Methods throw `TwigraphError`. Turning a throw into an `IpcResult` is the IPC adapter's
 * job, so there is exactly one place where an exception can cross a process boundary.
 */

export interface DesktopServiceOptions {
  readonly dataDir: string
  readonly configPath: string
  readonly data: DataStore
  readonly registry: FolderRegistry
  /** Injected so a test can pin timings and timestamps. */
  readonly now?: () => number
  /** Resolves to `null` when the user closed the picker without choosing. */
  readonly pickFolder: () => Promise<string | null>
  /** Resolves to an empty string on success, as Electron's `shell.openPath` does. */
  readonly openPath: (absolutePath: string) => Promise<string>
  readonly revealInFolder: (absolutePath: string) => void
  readonly emit: (event: IpcEvent, payload: unknown) => void
  /** From the environment, so a headless run can refuse the network before any config exists. */
  readonly offline?: boolean
}

export interface DesktopService {
  foldersList(): Promise<readonly FolderSummary[]>
  foldersAdd(): Promise<FolderSummary | null>
  foldersRemove(folderId: string): Promise<void>
  indexStart(folderId: string): Promise<void>
  indexCancel(): Promise<void>
  indexStatus(): Promise<IndexStatus>
  searchQuery(query: string, options?: SearchOptions): Promise<SearchResult>
  askQuestion(query: string): Promise<Answer>
  sourceOpen(absolutePath: string): Promise<void>
  sourceReveal(absolutePath: string): Promise<void>
  settingsGet(): Promise<TwigraphConfig>
  settingsSet(patch: SettingsPatch): Promise<TwigraphConfig>
  privacyStatus(): Promise<PrivacyStatus>
  engineStatus(): Promise<EngineStatus>
  modelPrepare(): Promise<EmbeddingStatus>
  llmSetProvider(provider: AnswerProviderId, model?: string): Promise<LlmStatus>
}

const EXTRACTIVE_LABEL = 'Extractive (Local)'

const NOT_IN_THIS_BUILD = {
  embeddings: 'Local embeddings are not part of this build; search is lexical and needs no model.',
  llm: 'No local language model provider is part of this build; answers come from the extractive engine.',
  model: 'This build ships no embedding model to prepare.',
} as const

export function createDesktopService(options: DesktopServiceOptions): DesktopService {
  const { dataDir, configPath, data, registry, pickFolder, openPath, revealInFolder, emit } =
    options
  const now = options.now ?? ((): number => Date.now())

  /**
   * The run in flight, claimed before the first await so two clicks cannot both start one.
   */
  let running: { readonly folderId: string; readonly controller: AbortController } | null = null

  const summarize = async (folder: FolderRecord): Promise<FolderSummary> => {
    const manifest = await data.store.readManifest(folder.id)
    return {
      id: folder.id,
      path: folder.path,
      addedAtMs: folder.addedAtMs,
      lastIndexedAtMs: folder.lastIndexedAtMs ?? manifest?.builtAtMs ?? null,
      documentCount: manifest?.documentCount ?? 0,
      chunkCount: manifest?.chunkCount ?? 0,
      failedCount: manifest?.failedCount ?? 0,
      indexSizeBytes: await data.store.sizeBytes(folder.id),
    }
  }

  /**
   * Every indexed record, read once per request.
   *
   * A folder with no manifest was never indexed, so it contributes nothing — searching it
   * would be searching a folder the user has not built yet.
   */
  const loadCorpus = async (): Promise<{
    readonly chunks: readonly ChunkRecord[]
    readonly documents: readonly DocumentRecord[]
  }> => {
    const chunks: ChunkRecord[] = []
    const documents: DocumentRecord[] = []
    for (const folder of await registry.list()) {
      if ((await data.store.readManifest(folder.id)) === null) continue
      chunks.push(...(await data.store.readChunks(folder.id)))
      documents.push(...(await data.store.readDocuments(folder.id)))
    }
    return { chunks, documents }
  }

  const llmStatusOf = (config: TwigraphConfig): LlmStatus => ({
    provider: config.llm.provider,
    // The extractive engine is the only one that exists, and it is genuinely available.
    available: config.llm.provider === 'extractive',
    label: config.llm.provider === 'extractive' ? EXTRACTIVE_LABEL : config.llm.provider,
    model: config.llm.ollama.model === '' ? null : config.llm.ollama.model,
    models: [],
  })

  const writeConfig = async (next: TwigraphConfig): Promise<TwigraphConfig> => {
    // Round-tripped through the same validator the config file is read with, so a patch
    // can never write a config this build would refuse to load.
    const validated = parseConfig(JSON.parse(JSON.stringify(next)) as unknown)
    await saveConfig(configPath, validated)
    return validated
  }

  /**
   * A path the renderer may ask the shell to open.
   *
   * The renderer has no filesystem access, so without this check `source:open` would be a
   * way to ask the operating system to open any file on disk. Only a document that is in an
   * index the user built is reachable, and the comparison is exact because the renderer can
   * only ever echo back a path a hit handed it.
   */
  const assertIndexedSource = async (absolutePath: string): Promise<void> => {
    for (const folder of await registry.list()) {
      if ((await data.store.readManifest(folder.id)) === null) continue
      const documents = await data.store.readDocuments(folder.id)
      if (documents.some((document) => document.absolutePath === absolutePath)) return
    }
    throw new TwigraphError('INDEX_NOT_FOUND', 'That file is not part of an indexed folder')
  }

  return {
    foldersList: async (): Promise<readonly FolderSummary[]> =>
      Promise.all((await registry.list()).map(summarize)),

    foldersAdd: async (): Promise<FolderSummary | null> => {
      const chosen = await pickFolder()
      if (chosen === null) return null

      const canonical = canonicalFolderPath(chosen)
      let info
      try {
        info = await stat(canonical)
      } catch (error) {
        throw new TwigraphError('FOLDER_UNREADABLE', 'That folder could not be read', {
          cause: error,
        })
      }
      if (!info.isDirectory()) {
        throw new TwigraphError('FOLDER_UNREADABLE', 'That folder could not be read')
      }

      return summarize(await registry.add(canonical, now()))
    },

    foldersRemove: async (folderId: string): Promise<void> => {
      await registry.remove(folderId)
      // An index nobody can reach is not worth keeping, so it goes with the folder.
      await data.store.remove(folderId)
    },

    indexStart: async (folderId: string): Promise<void> => {
      if (running !== null) {
        throw new TwigraphError('INDEX_IN_PROGRESS', 'An indexing run is already going')
      }
      const controller = new AbortController()
      running = { folderId, controller }

      try {
        const folder = await registry.find(folderId)
        if (folder === null) {
          throw new TwigraphError('FOLDER_NOT_FOUND', 'No folder in the list has that id')
        }
        const config = await loadConfig(configPath)

        const result = await buildIndex(data, {
          folderId: folder.id,
          folderPath: folder.path,
          nowMs: now(),
          chunking: config.chunking,
          signal: controller.signal,
          onProgress: (progress) => {
            // Progress names files, never their contents.
            const event: IndexProgressEvent = { folderId: folder.id, ...progress }
            emit(IPC_EVENTS.indexProgress, event)
          },
        })

        for (const failure of result.failures) emit(IPC_EVENTS.indexError, failure)
        await registry.update(folder.id, {
          lastIndexedAtMs: result.manifest.builtAtMs,
          documentCount: result.manifest.documentCount,
          chunkCount: result.manifest.chunkCount,
        })
        emit(IPC_EVENTS.indexDone, result.manifest)
      } finally {
        running = null
      }
    },

    indexCancel: async (): Promise<void> => {
      // Cancelling a run that has already finished is not an error: the button may have been
      // pressed while the last file was being written.
      running?.controller.abort()
    },

    indexStatus: async (): Promise<IndexStatus> => ({
      running: running !== null,
      folderId: running?.folderId ?? null,
    }),

    searchQuery: async (query: string, searchOptions?: SearchOptions): Promise<SearchResult> => {
      const config = await loadConfig(configPath)
      const retriever = createRetriever(loadCorpus, { config: config.retrieval, now })
      return retriever.search(query, searchOptions)
    },

    askQuestion: async (query: string): Promise<Answer> => {
      const config = await loadConfig(configPath)
      // Loaded once, so the snapshot is built from the very records the ranking saw rather
      // than from a second read that could disagree with it.
      const corpus = await loadCorpus()
      const retriever = createRetriever(async () => corpus, { config: config.retrieval, now })
      const result = await retriever.search(query)

      const snapshot: RetrievalSnapshot = {
        hits: result.hits,
        chunksById: new Map(corpus.chunks.map((chunk) => [chunk.id, chunk])),
        vectorsByChunkId: new Map(),
        confident: meetsConfidence(result, config.retrieval.minScore),
      }

      const engine = createExtractiveAnswerEngine()
      const answer = await engine.answer(query, snapshot)

      if (config.llm.provider !== engine.id) {
        // Saying which engine actually produced the answer matters more than pretending the
        // configured one was used.
        return {
          ...answer,
          note: `The configured provider (${config.llm.provider}) is not available in this build, so this answer came from the local ${engine.id} engine.`,
        }
      }
      return answer
    },

    sourceOpen: async (absolutePath: string): Promise<void> => {
      await assertIndexedSource(absolutePath)
      const failure = await openPath(absolutePath)
      if (failure !== '') {
        throw new TwigraphError('INTERNAL', 'That file could not be opened')
      }
    },

    sourceReveal: async (absolutePath: string): Promise<void> => {
      await assertIndexedSource(absolutePath)
      revealInFolder(absolutePath)
    },

    settingsGet: async (): Promise<TwigraphConfig> => loadConfig(configPath),

    settingsSet: async (patch: SettingsPatch): Promise<TwigraphConfig> => {
      if (patch.llm?.provider !== undefined && patch.llm.provider !== 'extractive') {
        throw new TwigraphError('LLM_UNAVAILABLE', NOT_IN_THIS_BUILD.llm)
      }
      const current = await loadConfig(configPath)

      return writeConfig({
        ...current,
        ...(patch.offline === undefined ? {} : { offline: patch.offline }),
        embeddings: { ...current.embeddings, ...patch.embeddings },
        llm: {
          ...current.llm,
          ...(patch.llm?.provider === undefined ? {} : { provider: patch.llm.provider }),
          ollama: {
            ...current.llm.ollama,
            ...(patch.llm?.model === undefined ? {} : { model: patch.llm.model }),
          },
        },
      })
    },

    privacyStatus: async (): Promise<PrivacyStatus> => {
      const config = await loadConfig(configPath)
      return {
        message: PRIVACY_MESSAGE,
        offline: (options.offline ?? false) || config.offline,
        engine: config.llm.provider,
        // Honest by construction: nothing in this build opens a connection, so there is no
        // destination to list, in any mode.
        allowedDestinations: [],
      }
    },

    engineStatus: async (): Promise<EngineStatus> => {
      const config = await loadConfig(configPath)
      return {
        embeddings: {
          available: false,
          prepared: false,
          enabled: config.embeddings.enabled,
          modelId: config.embeddings.modelId,
          label: NOT_IN_THIS_BUILD.embeddings,
        },
        llm: llmStatusOf(config),
        storagePath: dataDir,
      }
    },

    modelPrepare: async (): Promise<EmbeddingStatus> => {
      throw new TwigraphError('EMBEDDING_UNAVAILABLE', NOT_IN_THIS_BUILD.model)
    },

    llmSetProvider: async (provider: AnswerProviderId, model?: string): Promise<LlmStatus> => {
      if (provider !== 'extractive') {
        throw new TwigraphError('LLM_UNAVAILABLE', NOT_IN_THIS_BUILD.llm)
      }
      const current = await loadConfig(configPath)
      const next = await writeConfig({
        ...current,
        llm: {
          ...current.llm,
          provider,
          ollama: {
            ...current.llm.ollama,
            ...(model === undefined ? {} : { model }),
          },
        },
      })
      return llmStatusOf(next)
    },
  }
}
