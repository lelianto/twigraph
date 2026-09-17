import { stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { buildIndex, createIndexStore } from '@twigraph/indexing'
import { createExtractiveAnswerEngine, createRetriever, meetsConfidence } from '@twigraph/retrieval'
import {
  TwigraphError,
  PRIVACY_MESSAGE,
  canonicalFolderPath,
  createFolderRegistry,
  deleteDataDirectory,
  formatCitationLabel,
  loadConfig,
  toWireError,
} from '@twigraph/shared'
import type {
  ChunkRecord,
  Citation,
  DocumentRecord,
  FolderRecord,
  RetrievalSnapshot,
  SearchHit,
} from '@twigraph/shared'

import { isOffline, resolveDataDir } from './paths'

const USAGE = `twigraph — ask questions about your own files without uploading them anywhere.

Usage:
  twigraph folder add <path>        Add a folder to the list
  twigraph folder list              List the folders
  twigraph folder remove <id>       Forget a folder and delete its index
  twigraph index <folder-id>        Read a folder and write its index
  twigraph index --all              Index every folder
  twigraph search "<query>"         Search the indexed folders
  twigraph ask "<question>"         Answer a question from indexed folders
  twigraph status                   Show what is indexed and how much space it takes
  twigraph delete <folder-id>       Delete one index, keeping the folder in the list
  twigraph delete --all             Delete every index, the config and any prepared model
  twigraph privacy                  Show where your data is and what can be reached
  twigraph help                     Show this message

Options:
  --data-dir <path>   Where everything is kept (default: the platform's application data)
  --top <n>           How many search results to show
  --offline           Refuse anything that would need the network
  --json              Machine readable output

Environment:
  TWIGRAPH_DATA_DIR      Same as --data-dir
  TWIGRAPH_OFFLINE=1     Same as --offline
`

export interface CliIo {
  readonly out: (line: string) => void
  readonly err: (line: string) => void
  /** Injected so a test can pin timings and timestamps. */
  readonly now?: () => number
  readonly env?: NodeJS.ProcessEnv
  readonly cwd?: string
}

class UsageError extends Error {}

const VALUE_FLAGS = new Set(['--data-dir', '--top'])

interface ParsedArgs {
  readonly positionals: readonly string[]
  readonly flags: ReadonlySet<string>
  readonly values: ReadonlyMap<string, string>
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const positionals: string[] = []
  const flags = new Set<string>()
  const values = new Map<string, string>()

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === undefined) continue

    if (!argument.startsWith('--')) {
      positionals.push(argument)
      continue
    }

    if (VALUE_FLAGS.has(argument)) {
      const value = argv[index + 1]
      if (value === undefined) throw new UsageError(`${argument} needs a value`)
      values.set(argument, value)
      index += 1
      continue
    }

    flags.add(argument)
  }

  return { positionals, flags, values }
}

interface Context {
  readonly dataDir: string
  readonly configPath: string
  readonly json: boolean
  readonly offline: boolean
  readonly top: number | undefined
  readonly io: CliIo
  readonly cwd: string
  readonly now: () => number
  readonly flags: ReadonlySet<string>
}

const registryFor = (context: Context) => createFolderRegistry(context.configPath)
const storeFor = (context: Context) => createIndexStore({ dataDir: context.dataDir })

function emit(context: Context, human: readonly string[], payload: unknown): void {
  if (context.json) {
    context.io.out(JSON.stringify(payload))
    return
  }
  for (const line of human) context.io.out(line)
}

function orderByPath(folders: readonly FolderRecord[]): readonly FolderRecord[] {
  return [...folders].sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  )
}

function citationOf(hit: SearchHit, marker: number): Citation {
  return {
    marker,
    chunkId: hit.chunkId,
    filename: hit.filename,
    absolutePath: hit.absolutePath,
    ...(hit.page === undefined ? {} : { page: hit.page }),
    ...(hit.pageEnd === undefined ? {} : { pageEnd: hit.pageEnd }),
    headingPath: hit.headingPath,
    excerpt: hit.excerpt,
  }
}

async function folderCommand(context: Context, rest: readonly string[]): Promise<number> {
  const [action, argument] = rest
  const registry = registryFor(context)

  if (action === 'list') {
    const folders = orderByPath(await registry.list())
    emit(
      context,
      folders.length === 0
        ? ['No folders yet. Add one with: twigraph folder add <path>']
        : folders.map((folder) => `${folder.id}  ${folder.path}`),
      { folders },
    )
    return 0
  }

  if (action === 'add') {
    if (argument === undefined) throw new UsageError('usage: twigraph folder add <path>')
    const canonical = canonicalFolderPath(resolve(context.cwd, argument))

    const info = await stat(canonical).catch(() => null)
    if (info === null || !info.isDirectory()) {
      throw new TwigraphError('FOLDER_UNREADABLE', 'That folder could not be read')
    }

    const record = await registry.add(canonical, context.now())
    emit(
      context,
      [`Added ${record.path}`, `  id  ${record.id}`, `Index it with: twigraph index ${record.id}`],
      record,
    )
    return 0
  }

  if (action === 'remove') {
    if (argument === undefined) throw new UsageError('usage: twigraph folder remove <folder-id>')
    await registry.remove(argument)
    // An index nobody can reach is not worth keeping, so it goes with the folder.
    await storeFor(context).store.remove(argument)
    emit(context, [`Removed ${argument}`], { removed: argument })
    return 0
  }

  throw new UsageError('usage: twigraph folder <add|list|remove>')
}

async function indexCommand(context: Context, rest: readonly string[]): Promise<number> {
  const registry = registryFor(context)
  const data = storeFor(context)
  const everything = context.flags.has('--all')
  const wanted = rest[0]

  const registered = await registry.list()
  const targets = everything
    ? orderByPath(registered)
    : registered.filter((folder) => folder.id === wanted)

  if (targets.length === 0) {
    if (everything) {
      context.io.err('Nothing to index. Add a folder first: twigraph folder add <path>')
      return 0
    }
    if (wanted === undefined) {
      throw new UsageError('usage: twigraph index <folder-id> | twigraph index --all')
    }
    throw new TwigraphError('FOLDER_NOT_FOUND', 'No folder in the list has that id')
  }

  const config = await loadConfig(context.configPath)
  const summaries: unknown[] = []

  for (const folder of targets) {
    const result = await buildIndex(data, {
      folderId: folder.id,
      folderPath: folder.path,
      nowMs: context.now(),
      chunking: config.chunking,
      onProgress: (progress) => {
        // Progress names files, never their contents.
        if (context.json || progress.currentFile === null) return
        context.io.err(
          `  [${progress.documentsProcessed}/${progress.documentsTotal}] ${progress.currentFile}`,
        )
      },
    })

    await registry.update(folder.id, {
      lastIndexedAtMs: result.manifest.builtAtMs,
      documentCount: result.manifest.documentCount,
      chunkCount: result.manifest.chunkCount,
    })

    summaries.push({
      folderId: folder.id,
      path: folder.path,
      documentCount: result.manifest.documentCount,
      chunkCount: result.manifest.chunkCount,
      failedCount: result.manifest.failedCount,
      skipped: result.skipped.length,
    })

    if (context.json) continue

    context.io.out(folder.path)
    context.io.out(
      `  ${result.manifest.documentCount} documents, ${result.manifest.chunkCount} chunks, ` +
        `${result.manifest.failedCount} unreadable, ${result.skipped.length} skipped`,
    )
    for (const failure of result.failures) {
      context.io.err(`  ${failure.relativePath}: ${failure.message} (${failure.code})`)
    }
  }

  emit(context, [], { indexed: summaries })
  return 0
}

async function searchCommand(context: Context, rest: readonly string[]): Promise<number> {
  const query = rest.join(' ').trim()
  if (query === '') throw new UsageError('usage: twigraph search "<query>"')

  const registry = registryFor(context)
  const data = storeFor(context)
  const config = await loadConfig(context.configPath)

  const retriever = createRetriever(
    async () => {
      const chunks: ChunkRecord[] = []
      const documents: DocumentRecord[] = []
      for (const folder of await registry.list()) {
        if ((await data.store.readManifest(folder.id)) === null) continue
        chunks.push(...(await data.store.readChunks(folder.id)))
        documents.push(...(await data.store.readDocuments(folder.id)))
      }
      return { chunks, documents }
    },
    { config: config.retrieval, now: context.now },
  )

  const result = await retriever.search(
    query,
    context.top === undefined ? undefined : { topK: context.top },
  )
  const confident = meetsConfidence(result, config.retrieval.minScore)

  if (context.json) {
    emit(context, [], {
      query: result.query,
      mode: result.mode,
      tookMs: result.tookMs,
      confident,
      hits: result.hits.map((hit, position) => ({
        ...hit,
        label: formatCitationLabel(citationOf(hit, position + 1)),
      })),
    })
    return 0
  }

  if (result.hits.length === 0) {
    context.io.out(`No matches for "${result.query}".`)
    return 0
  }

  context.io.out(
    `${result.hits.length} result${result.hits.length === 1 ? '' : 's'} for "${result.query}" ` +
      `(${result.mode}, ${result.tookMs} ms)`,
  )
  for (const [position, hit] of result.hits.entries()) {
    context.io.out(
      `  ${hit.score.toFixed(2)}  ${formatCitationLabel(citationOf(hit, position + 1))}`,
    )
    context.io.out(`        ${hit.excerpt}`)
  }
  if (!confident) {
    context.io.out(
      `Nothing here clears the confidence threshold of ${config.retrieval.minScore}. ` +
        'Treat these as sources to read, not as an answer.',
    )
  }
  return 0
}

async function askCommand(context: Context, rest: readonly string[]): Promise<number> {
  const question = rest.join(' ').trim()
  if (question === '') throw new UsageError('usage: twigraph ask "<question>"')

  const registry = registryFor(context)
  const data = storeFor(context)
  const config = await loadConfig(context.configPath)

  let loadedChunks: ChunkRecord[] = []
  const retriever = createRetriever(
    async () => {
      const chunks: ChunkRecord[] = []
      const documents: DocumentRecord[] = []
      for (const folder of await registry.list()) {
        if ((await data.store.readManifest(folder.id)) === null) continue
        chunks.push(...(await data.store.readChunks(folder.id)))
        documents.push(...(await data.store.readDocuments(folder.id)))
      }
      loadedChunks = chunks
      return { chunks, documents }
    },
    { config: config.retrieval, now: context.now },
  )

  const result = await retriever.search(
    question,
    context.top === undefined ? undefined : { topK: context.top },
  )
  const confident = meetsConfidence(result, config.retrieval.minScore)

  const chunksById = new Map<string, ChunkRecord>(loadedChunks.map((c) => [c.id, c]))
  const snapshot: RetrievalSnapshot = {
    hits: result.hits,
    chunksById,
    vectorsByChunkId: new Map(),
    confident,
  }

  const engine = createExtractiveAnswerEngine()
  const answer = await engine.answer(question, snapshot)

  if (context.json) {
    emit(context, [], answer)
    return 0
  }

  if (answer.status === 'insufficient') {
    context.io.out(answer.text)
    if (answer.sources.length > 0) {
      context.io.out('')
      context.io.out('Sources consulted:')
      for (const [position, hit] of answer.sources.entries()) {
        context.io.out(
          `  ${hit.score.toFixed(2)}  ${formatCitationLabel(citationOf(hit, position + 1))}`,
        )
      }
    }
    return 0
  }

  context.io.out(answer.text)
  context.io.out('')
  context.io.out('Citations:')
  for (const citation of answer.citations) {
    context.io.out(`  [${citation.marker}]  ${formatCitationLabel(citation)}`)
    context.io.out(`        ${citation.excerpt}`)
  }
  return 0
}

async function statusCommand(context: Context): Promise<number> {
  const registry = registryFor(context)
  const data = storeFor(context)
  const folders = orderByPath(await registry.list())
  const rows: unknown[] = []
  const lines: string[] = []

  for (const folder of folders) {
    const manifest = await data.store.readManifest(folder.id)
    const sizeBytes = await data.store.sizeBytes(folder.id)

    rows.push({ folderId: folder.id, path: folder.path, sizeBytes, manifest })
    lines.push(folder.path)
    lines.push(
      manifest === null
        ? `  ${folder.id}  not indexed yet`
        : `  ${folder.id}  ${manifest.documentCount} documents, ${manifest.chunkCount} chunks, ` +
            `${manifest.failedCount} unreadable, ${sizeBytes} bytes`,
    )
  }

  lines.push('')
  lines.push(`data directory  ${context.dataDir}`)
  emit(context, lines, { dataDir: context.dataDir, folders: rows })
  return 0
}

async function deleteCommand(context: Context, rest: readonly string[]): Promise<number> {
  if (context.flags.has('--all')) {
    // Deletion removes what twigraph wrote and nothing else. See `deleteDataDirectory`.
    const deletion = await deleteDataDirectory(context.dataDir)

    if (deletion.removed.length === 0 && !deletion.directoryRemoved) {
      emit(context, ['Nothing to delete.'], { dataDir: context.dataDir, ...deletion, all: true })
      return 0
    }

    const lines = [`Deleted ${deletion.removed.join(', ')}`]
    lines.push(
      deletion.directoryRemoved
        ? `Removed ${context.dataDir}`
        : `Left ${context.dataDir} in place: it still holds ${deletion.remaining.join(', ')}`,
    )
    emit(context, lines, { dataDir: context.dataDir, ...deletion, all: true })
    return 0
  }

  const folderId = rest[0]
  if (folderId === undefined) {
    throw new UsageError('usage: twigraph delete <folder-id> | twigraph delete --all')
  }

  await storeFor(context).store.remove(folderId)
  emit(context, [`Deleted the index for ${folderId}`], { deleted: folderId, all: false })
  return 0
}

async function privacyCommand(context: Context): Promise<number> {
  const config = await loadConfig(context.configPath)
  const offline = context.offline || config.offline

  emit(
    context,
    [
      PRIVACY_MESSAGE,
      '',
      `data directory  ${context.dataDir}`,
      `offline         ${offline ? 'yes' : 'no'}`,
      'network         no command in this build makes a request',
    ],
    {
      message: PRIVACY_MESSAGE,
      dataDir: context.dataDir,
      offline,
      allowedDestinations: [],
    },
  )
  return 0
}

export async function run(argv: readonly string[], io: CliIo): Promise<number> {
  const env = io.env ?? process.env

  try {
    const args = parseArgs(argv)
    const [group, ...rest] = args.positionals

    if (group === undefined || group === 'help' || args.flags.has('--help')) {
      io.out(USAGE)
      return 0
    }

    const dataDir = resolveDataDir(args.values.get('--data-dir'), env)
    const context: Context = {
      dataDir,
      configPath: join(dataDir, 'config.json'),
      json: args.flags.has('--json'),
      offline: args.flags.has('--offline') || isOffline(env),
      top: topOf(args.values.get('--top')),
      io,
      cwd: io.cwd ?? process.cwd(),
      now: io.now ?? (() => Date.now()),
      flags: args.flags,
    }

    if (group === 'folder') return await folderCommand(context, rest)
    if (group === 'index') return await indexCommand(context, rest)
    if (group === 'search') return await searchCommand(context, rest)
    if (group === 'ask') return await askCommand(context, rest)
    if (group === 'status') return await statusCommand(context)
    if (group === 'delete') return await deleteCommand(context, rest)
    if (group === 'privacy') return await privacyCommand(context)

    throw new UsageError(`Unknown command: ${group}. Run "twigraph help".`)
  } catch (error) {
    if (error instanceof UsageError) {
      io.err(error.message)
      return 2
    }

    // A message the user can act on, with nothing from their disk in it.
    io.err(`error: ${toWireError(error).message}`)
    return 1
  }
}

function topOf(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new UsageError('--top needs a whole number of results, 1 or more')
  }
  return parsed
}
