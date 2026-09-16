export { buildIndex } from './build'
export type { BuildIndexOptions, BuildIndexResult, BuildProgress } from './build'

export { chunkDocument } from './chunk'
export type { ChunkingOptions } from './chunk'

export { documentIdFor } from './ids'

export { createIndexStore } from './index-store'
export type { DataStore, IndexStoreOptions } from './index-store'

export {
  INDEX_SCHEMA_VERSION,
  indexDirectory,
  indexesRoot,
  previousDirectory,
  stagingDirectory,
} from './layout'

export { parseJsonLines, stableStringify, toJsonLines } from './serialize'
