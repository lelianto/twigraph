import { readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { FolderRecord } from './contracts/stores'
import { ensureDataDirectory } from './data-dir'
import { TwigraphError } from './errors'

export const CONFIG_VERSION = 1

const MAX_SAFE = Number.MAX_SAFE_INTEGER

export type LlmProviderId = 'extractive' | 'ollama'

export interface Bm25Config {
  readonly k1: number
  readonly b: number
}

export interface RetrievalConfig {
  readonly topK: number
  /** Fused score the top hit must reach before an answer is attempted. */
  readonly minScore: number
  readonly rrfK: number
  readonly bm25: Bm25Config
}

export interface ChunkingConfig {
  readonly targetTokens: number
  readonly overlapRatio: number
}

export interface EmbeddingsConfig {
  readonly enabled: boolean
  readonly modelId: string
  readonly dtype: string
}

export interface OllamaConfig {
  /** Loopback only. A remote base URL would break the product's core promise. */
  readonly baseUrl: string
  readonly model: string
  readonly timeoutMs: number
  readonly numCtx: number
}

export interface LlmConfig {
  readonly provider: LlmProviderId
  readonly ollama: OllamaConfig
}

export interface StorageConfig {
  readonly dataDir?: string
}

export interface TwigraphConfig {
  readonly version: number
  readonly folders: readonly FolderRecord[]
  readonly offline: boolean
  readonly retrieval: RetrievalConfig
  readonly chunking: ChunkingConfig
  readonly embeddings: EmbeddingsConfig
  readonly llm: LlmConfig
  readonly storage?: StorageConfig
}

export interface ConfigOverrides {
  readonly folders?: readonly FolderRecord[]
  readonly offline?: boolean
  readonly storage?: StorageConfig
  readonly retrieval?: {
    readonly topK?: number
    readonly minScore?: number
    readonly rrfK?: number
    readonly bm25?: { readonly k1?: number; readonly b?: number }
  }
  readonly chunking?: {
    readonly targetTokens?: number
    readonly overlapRatio?: number
  }
  readonly embeddings?: {
    readonly enabled?: boolean
    readonly modelId?: string
    readonly dtype?: string
  }
  readonly llm?: {
    readonly provider?: LlmProviderId
    readonly ollama?: {
      readonly baseUrl?: string
      readonly model?: string
      readonly timeoutMs?: number
      readonly numCtx?: number
    }
  }
}

const DEFAULT_RETRIEVAL: RetrievalConfig = {
  topK: 8,
  minScore: 0.35,
  rrfK: 60,
  bm25: { k1: 1.2, b: 0.75 },
}

const DEFAULT_CHUNKING: ChunkingConfig = { targetTokens: 900, overlapRatio: 0.12 }

const DEFAULT_EMBEDDINGS: EmbeddingsConfig = {
  enabled: true,
  modelId: 'Xenova/all-MiniLM-L6-v2',
  dtype: 'q8',
}

const DEFAULT_OLLAMA: OllamaConfig = {
  baseUrl: 'http://127.0.0.1:11434',
  model: '',
  timeoutMs: 60_000,
  numCtx: 4096,
}

export function defaultConfig(overrides: ConfigOverrides = {}): TwigraphConfig {
  const base: TwigraphConfig = {
    version: CONFIG_VERSION,
    folders: overrides.folders ?? [],
    offline: overrides.offline ?? false,
    retrieval: {
      ...DEFAULT_RETRIEVAL,
      ...overrides.retrieval,
      bm25: { ...DEFAULT_RETRIEVAL.bm25, ...overrides.retrieval?.bm25 },
    },
    chunking: { ...DEFAULT_CHUNKING, ...overrides.chunking },
    embeddings: { ...DEFAULT_EMBEDDINGS, ...overrides.embeddings },
    llm: {
      provider: overrides.llm?.provider ?? 'extractive',
      ollama: { ...DEFAULT_OLLAMA, ...overrides.llm?.ollama },
    },
  }

  return overrides.storage === undefined ? base : { ...base, storage: overrides.storage }
}

function fail(path: string, expected: string): never {
  throw new TwigraphError('CONFIG_INVALID', `${path} ${expected}`)
}

function asObject(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return fail(path, 'must be an object')
  }
  return value as Record<string, unknown>
}

function asBoolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') return fail(path, 'must be true or false')
  return value
}

function asString(value: unknown, path: string, allowEmpty = false): string {
  if (typeof value !== 'string') return fail(path, 'must be a string')
  if (!allowEmpty && value.trim() === '') return fail(path, 'must not be empty')
  return value
}

function asNumber(value: unknown, path: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    return fail(path, `must be a number between ${min} and ${max}`)
  }
  return value
}

function asInteger(value: unknown, path: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    return fail(path, `must be an integer between ${min} and ${max}`)
  }
  return value
}

function optionalInteger(value: unknown, path: string): number | undefined {
  return value === undefined ? undefined : asInteger(value, path, 0, MAX_SAFE)
}

function parseFolders(value: unknown, label: string): readonly FolderRecord[] {
  if (!Array.isArray(value)) return fail(label, 'must be an array')
  return value.map((entry, index) => {
    const at = `${label}[${index}]`
    const raw = asObject(entry, at)
    const lastIndexedAtMs = optionalInteger(raw.lastIndexedAtMs, `${at}.lastIndexedAtMs`)
    const documentCount = optionalInteger(raw.documentCount, `${at}.documentCount`)
    const chunkCount = optionalInteger(raw.chunkCount, `${at}.chunkCount`)

    return {
      id: asString(raw.id, `${at}.id`),
      path: asString(raw.path, `${at}.path`),
      addedAtMs: asInteger(raw.addedAtMs, `${at}.addedAtMs`, 0, MAX_SAFE),
      ...(lastIndexedAtMs === undefined ? {} : { lastIndexedAtMs }),
      ...(documentCount === undefined ? {} : { documentCount }),
      ...(chunkCount === undefined ? {} : { chunkCount }),
    }
  })
}

function parseRetrieval(value: unknown, fallback: RetrievalConfig): RetrievalConfig {
  if (value === undefined) return fallback
  const raw = asObject(value, 'retrieval')
  const bm25 = asObject(raw.bm25, 'retrieval.bm25')
  return {
    topK: asInteger(raw.topK, 'retrieval.topK', 1, 1000),
    minScore: asNumber(raw.minScore, 'retrieval.minScore', 0, 1),
    rrfK: asInteger(raw.rrfK, 'retrieval.rrfK', 1, 10_000),
    bm25: {
      k1: asNumber(bm25.k1, 'retrieval.bm25.k1', 0, 100),
      b: asNumber(bm25.b, 'retrieval.bm25.b', 0, 1),
    },
  }
}

function parseChunking(value: unknown, fallback: ChunkingConfig): ChunkingConfig {
  if (value === undefined) return fallback
  const raw = asObject(value, 'chunking')
  return {
    targetTokens: asInteger(raw.targetTokens, 'chunking.targetTokens', 64, 8192),
    overlapRatio: asNumber(raw.overlapRatio, 'chunking.overlapRatio', 0, 0.5),
  }
}

function parseEmbeddings(value: unknown, fallback: EmbeddingsConfig): EmbeddingsConfig {
  if (value === undefined) return fallback
  const raw = asObject(value, 'embeddings')
  return {
    enabled: asBoolean(raw.enabled, 'embeddings.enabled'),
    modelId: asString(raw.modelId, 'embeddings.modelId'),
    dtype: asString(raw.dtype, 'embeddings.dtype'),
  }
}

function parseLlm(value: unknown, fallback: LlmConfig): LlmConfig {
  if (value === undefined) return fallback
  const raw = asObject(value, 'llm')
  const provider = raw.provider
  if (provider !== 'extractive' && provider !== 'ollama') {
    return fail('llm.provider', 'must be "extractive" or "ollama"')
  }
  const ollama = asObject(raw.ollama, 'llm.ollama')
  return {
    provider,
    ollama: {
      baseUrl: asString(ollama.baseUrl, 'llm.ollama.baseUrl'),
      // Empty until the user picks one of the models Ollama actually has installed.
      model: asString(ollama.model, 'llm.ollama.model', true),
      timeoutMs: asInteger(ollama.timeoutMs, 'llm.ollama.timeoutMs', 1000, 600_000),
      numCtx: asInteger(ollama.numCtx, 'llm.ollama.numCtx', 512, 131_072),
    },
  }
}

/**
 * Validates a config document.
 *
 * `version` is required. Beyond that a section is all-or-nothing: absent means "use the
 * defaults", present means every field must be valid. Half a section is treated as a
 * mistake rather than silently completed, because a half-specified retrieval config is
 * exactly the kind of thing that produces quietly wrong results.
 */
export function parseConfig(value: unknown): TwigraphConfig {
  const raw = asObject(value, 'config')

  if (raw.version !== CONFIG_VERSION) {
    throw new TwigraphError(
      'CONFIG_VERSION_UNSUPPORTED',
      `Unsupported config version: this build understands version ${CONFIG_VERSION}, but the file declares ${JSON.stringify(raw.version)}`,
    )
  }

  const defaults = defaultConfig()

  return {
    version: CONFIG_VERSION,
    folders: raw.folders === undefined ? [] : parseFolders(raw.folders, 'folders'),
    offline: raw.offline === undefined ? defaults.offline : asBoolean(raw.offline, 'offline'),
    retrieval: parseRetrieval(raw.retrieval, defaults.retrieval),
    chunking: parseChunking(raw.chunking, defaults.chunking),
    embeddings: parseEmbeddings(raw.embeddings, defaults.embeddings),
    llm: parseLlm(raw.llm, defaults.llm),
    ...(raw.storage === undefined
      ? {}
      : { storage: asObject(raw.storage, 'storage') as StorageConfig }),
  }
}

function isMissingFile(error: unknown): boolean {
  return (
    error !== null && typeof error === 'object' && (error as { code?: unknown }).code === 'ENOENT'
  )
}

/** A missing config is the normal first-run state, not an error. */
export async function loadConfig(configPath: string): Promise<TwigraphConfig> {
  let raw: string
  try {
    raw = await readFile(configPath, 'utf8')
  } catch (error) {
    if (isMissingFile(error)) return defaultConfig()
    throw new TwigraphError('CONFIG_INVALID', 'The twigraph config file could not be read', {
      cause: error,
    })
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new TwigraphError('CONFIG_INVALID', 'The twigraph config file is not valid JSON', {
      cause: error,
    })
  }

  return parseConfig(parsed)
}

/**
 * Atomic: a torn write must never leave an unreadable config behind.
 *
 * It also brings the data directory into being, marker and all. The first run of a fresh
 * install has no directory yet, and making every caller responsible for creating it means
 * every caller can forget. Writing here is also what claims the directory as twigraph's, so
 * that a later "delete everything" knows what it is allowed to touch.
 */
export async function saveConfig(configPath: string, config: TwigraphConfig): Promise<void> {
  const temporaryPath = `${configPath}.tmp`
  await ensureDataDirectory(dirname(configPath))
  await writeFile(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
  await rename(temporaryPath, configPath)
}
