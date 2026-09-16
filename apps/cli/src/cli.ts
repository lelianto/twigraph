import { stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { buildIndex, createIndexStore } from '@mulat/indexing'
import { createRetriever, meetsConfidence } from '@mulat/retrieval'
import {
  MulatError,
  PRIVACY_MESSAGE,
  canonicalFolderPath,
  createFolderRegistry,
  deleteDataDirectory,
  formatCitationLabel,
  loadConfig,
  toWireError,
} from '@mulat/shared'
import type { ChunkRecord, Citation, DocumentRecord, FolderRecord, SearchHit } from '@mulat/shared'

import { isOffline, resolveDataDir } from './paths'

const USAGE = `mulat — ask questions about your own files without uploading them anywhere.

Usage:
  mulat folder add <path>        Add a folder to the list
  mulat folder list              List the folders
  mulat folder remove <id>       Forget a folder and delete its index
  mulat index <folder-id>        Read a folder and write its index
  mulat index --all              Index every folder
  mulat search "<query>"         Search the indexed folders
  mulat status                   Show what is indexed and how much space it takes
  mulat delete <folder-id>       Delete one index, keeping the folder in the list
  mulat delete --all             Delete every index, the config and any prepared model
  mulat privacy                  Show where your data is and what can be reached
  mulat help                     Show this message

Options:
  --data-dir <path>   Where everything is kept (default: the platform's application data)
  --top <n>           How many search results to show
  --offline           Refuse anything that would need the network
  --json              Machine readable output

Environment:
  MULAT_DATA_DIR      Same as --data-dir
  MULAT_OFFLINE=1     Same as --offline
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
        ? ['No folders yet. Add one with: mulat folder add <path>']
        : folders.map((folder) => `${folder.id}  ${folder.path}`),
      { folders },
    )
    return 0
  }

  if (action === 'add') {
    if (argument === undefined) throw new UsageError('usage: mulat folder add <path>')
    const canonical = canonicalFolderPath(resolve(context.cwd, argument))

    const info = await stat(canonical).catch(() => null)
    if (info === null || !info.isDirectory()) {
      throw new MulatError('FOLDER_UNREADABLE', 'That folder could not be read')
    }

    const record = await registry.add(canonical, context.now())
    emit(
      context,
      [`Added ${record.path}`, `  id  ${record.id}`, `Index it with: mulat index ${record.id}`],
      record,
    )
    return 0
  }

  if (action === 'remove') {
    if (argument === undefined) throw new UsageError('usage: mulat folder remove <folder-id>')
    await registry.remove(argument)
    // An index nobody can reach is not worth keeping, so it goes with the folder.
    await storeFor(context).store.remove(argument)
    emit(context, [`Removed ${argument}`], { removed: argument })
    return 0
  }

  throw new UsageError('usage: mulat folder <add|list|remove>')
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
      context.io.err('Nothing to index. Add a folder first: mulat folder add <path>')
      return 0
    }
    if (wanted === undefined) {
      throw new UsageError('usage: mulat index <folder-id> | mulat index --all')
    }
    throw new MulatError('FOLDER_NOT_FOUND', 'No folder in the list has that id')
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
  if (query === '') throw new UsageError('usage: mulat search "<query>"')

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
    // Deletion removes what mulat wrote and nothing else. See `deleteDataDirectory`.
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
    throw new UsageError('usage: mulat delete <folder-id> | mulat delete --all')
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
    if (group === 'status') return await statusCommand(context)
    if (group === 'delete') return await deleteCommand(context, rest)
    if (group === 'privacy') return await privacyCommand(context)

    throw new UsageError(`Unknown command: ${group}. Run "mulat help".`)
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
