export type {
  Answer,
  AnswerEngine,
  AnswerProviderId,
  Citation,
  Passage,
  RetrievalSnapshot,
  Retriever,
  SearchHit,
  SearchOptions,
  SearchResult,
} from './contracts/answer'

export type {
  Block,
  BlockKind,
  DocumentFailure,
  DocumentMetadata,
  DocumentParser,
  ParsedDocument,
  ParseInput,
} from './contracts/document'

export type {
  ChunkRecord,
  DocumentRecord,
  EmbeddingSignature,
  FolderRecord,
  FolderRegistry,
  IndexManifest,
  IndexPayload,
  IndexStats,
  IndexStore,
  VectorEntry,
  VectorHit,
  VectorStore,
} from './contracts/stores'

export type {
  ContextBlock,
  EmbeddingProvider,
  GeneratedAnswer,
  GenerateOptions,
  GenerateRequest,
  LanguageModelProvider,
  PrepareProgress,
} from './contracts/providers'

export { collapseWhitespace, assertGrounded, isVerbatimExcerpt } from './grounding'
export {
  describeLocation,
  formatCitationLabel,
  formatHeadingPath,
  formatPageRange,
} from './citations'
export { canonicalFolderPath, folderIdFor } from './folders'
export { createFolderRegistry } from './folder-registry'

export {
  DATA_ARTIFACTS,
  DATA_MARKER_APPLICATION,
  DATA_MARKER_FILE,
  DATA_MARKER_VERSION,
  dataMarkerPath,
  deleteDataDirectory,
  ensureDataDirectory,
  isMulatDataDirectory,
  readDataMarker,
} from './data-dir'
export type { DataDeletion, DataMarker } from './data-dir'

export { CONFIG_VERSION, defaultConfig, loadConfig, parseConfig, saveConfig } from './config'
export type {
  Bm25Config,
  ChunkingConfig,
  ConfigOverrides,
  EmbeddingsConfig,
  LlmConfig,
  LlmProviderId,
  MulatConfig,
  OllamaConfig,
  RetrievalConfig,
  StorageConfig,
} from './config'

export { isMulatError, MulatError, toWireError } from './errors'
export type { ErrorCode, ErrorDetail, MulatErrorOptions, WireError } from './errors'

export { IPC_CHANNELS, IPC_EVENTS, PRIVACY_MESSAGE } from './ipc'
export type {
  EmbeddingStatus,
  EngineStatus,
  FolderSummary,
  IndexPhase,
  IndexProgressEvent,
  IndexStatus,
  IpcChannel,
  IpcEvent,
  IpcFailure,
  IpcOk,
  IpcResult,
  LlmStatus,
  MulatApi,
  PrivacyStatus,
  SettingsPatch,
} from './ipc'
