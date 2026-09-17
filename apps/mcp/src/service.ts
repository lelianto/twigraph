import { createRetriever, meetsConfidence } from '@twigraph/retrieval'
import type {
  ChunkRecord,
  DocumentRecord,
  FolderRecord,
  FolderRegistry,
  IndexManifest,
  IndexStore,
  RetrievalConfig,
  SearchHit,
} from '@twigraph/shared'

export interface McpSearchInput {
  readonly query: string
  readonly topK?: number
  readonly folderIds?: readonly string[]
}

export interface McpSearchResult {
  readonly query: string
  readonly mode: 'lexical' | 'semantic' | 'hybrid'
  readonly tookMs: number
  readonly confident: boolean
  readonly hits: readonly SearchHit[]
}

export interface McpFolderStatus extends FolderRecord {
  readonly indexed: boolean
  readonly manifest: IndexManifest | null
  readonly sizeBytes: number
}

export interface McpChunkResult {
  readonly chunk: ChunkRecord
  readonly document: DocumentRecord
  readonly folder: FolderRecord
}

export interface McpSearchService {
  search(input: McpSearchInput): Promise<McpSearchResult>
  status(): Promise<{ readonly folders: readonly McpFolderStatus[] }>
  getChunk(input: { readonly chunkId: string }): Promise<McpChunkResult | null>
}

export interface McpSearchServiceOptions {
  readonly registry: FolderRegistry
  readonly store: IndexStore
  readonly retrieval: RetrievalConfig
  readonly now?: () => number
}

export function createMcpSearchService(options: McpSearchServiceOptions): McpSearchService {
  const { registry, store, retrieval, now } = options

  async function selectedFolders(folderIds?: readonly string[]): Promise<readonly FolderRecord[]> {
    const folders = await registry.list()
    if (folderIds === undefined || folderIds.length === 0) return folders

    const wanted = new Set(folderIds)
    const known = new Set(folders.map((folder) => folder.id))
    const unknown = [...wanted].filter((id) => !known.has(id))
    if (unknown.length > 0) throw new Error(`Unknown folder id: ${unknown.join(', ')}`)
    return folders.filter((folder) => wanted.has(folder.id))
  }

  return {
    search: async (input): Promise<McpSearchResult> => {
      const folders = await selectedFolders(input.folderIds)
      const retriever = createRetriever(
        async () => {
          const chunks: ChunkRecord[] = []
          const documents: DocumentRecord[] = []
          for (const folder of folders) {
            if ((await store.readManifest(folder.id)) === null) continue
            chunks.push(...(await store.readChunks(folder.id)))
            documents.push(...(await store.readDocuments(folder.id)))
          }
          return { chunks, documents }
        },
        { config: retrieval, ...(now === undefined ? {} : { now }) },
      )
      const result = await retriever.search(
        input.query,
        input.topK === undefined ? undefined : { topK: input.topK },
      )
      return { ...result, confident: meetsConfidence(result, retrieval.minScore) }
    },

    status: async () => {
      const folders = await registry.list()
      return {
        folders: await Promise.all(
          folders.map(async (folder): Promise<McpFolderStatus> => {
            const manifest = await store.readManifest(folder.id)
            return {
              ...folder,
              indexed: manifest !== null,
              manifest,
              sizeBytes: await store.sizeBytes(folder.id),
            }
          }),
        ),
      }
    },

    getChunk: async ({ chunkId }) => {
      for (const folder of await registry.list()) {
        if ((await store.readManifest(folder.id)) === null) continue
        const chunk = (await store.readChunks(folder.id)).find((entry) => entry.id === chunkId)
        if (chunk === undefined) continue
        const document = (await store.readDocuments(folder.id)).find(
          (entry) => entry.id === chunk.documentId,
        )
        if (document === undefined) return null
        return { chunk, document, folder }
      }
      return null
    },
  }
}
