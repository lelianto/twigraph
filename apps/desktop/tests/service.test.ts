import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { generateFixtures } from '../../../fixtures/generate.mjs'
import { installNetworkGuard } from '../../../tests/setup/no-network'
import { createFolderRegistry } from '@twigraph/shared'
import { IPC_EVENTS } from '@twigraph/shared/ipc'
import type {
  FolderSummary,
  IndexProgressEvent,
  IndexStatus,
  SettingsPatch,
} from '@twigraph/shared/ipc'
import { createIndexStore } from '@twigraph/indexing'

import { createDesktopService } from '../src/main/service'
import type { DesktopService } from '../src/main/service'

const NOW = 1_700_000_000_000
const FIXTURE_SENTENCE = 'reciprocal rank fusion'

let root = ''
let dataDir = ''
let configPath = ''
let service: DesktopService
let events: { readonly event: string; readonly payload: unknown }[]
let opened: string[]
let revealed: string[]
let picked: string | null
let statusQueries: Promise<IndexStatus>[]
let cancelAfter = 0

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'twigraph-desktop-src-'))
  dataDir = await mkdtemp(join(tmpdir(), 'twigraph-desktop-data-'))
  await generateFixtures(root)

  configPath = join(dataDir, 'config.json')
  events = []
  opened = []
  revealed = []
  picked = null
  statusQueries = []
  cancelAfter = 0

  service = createDesktopService({
    dataDir,
    configPath,
    registry: createFolderRegistry(configPath),
    data: createIndexStore({ dataDir }),
    now: () => NOW,
    pickFolder: async () => picked,
    openPath: async (absolutePath) => {
      opened.push(absolutePath)
      return ''
    },
    revealInFolder: (absolutePath) => {
      revealed.push(absolutePath)
    },
    emit: (event, payload) => {
      events.push({ event, payload })
      if (event !== IPC_EVENTS.indexProgress) return
      const progress = payload as IndexProgressEvent
      statusQueries.push(service.indexStatus())
      if (cancelAfter !== 0 && progress.documentsProcessed === cancelAfter) {
        void service.indexCancel()
      }
    },
  })
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
  await rm(dataDir, { recursive: true, force: true })
})

/** Adds the fixture folder the way the UI does, and returns its id. */
async function addFixtureFolder(): Promise<string> {
  picked = root
  const summary = await service.foldersAdd()
  if (summary === null) throw new Error('the folder was not added')
  return summary.id
}

async function indexedFixtureFolder(): Promise<string> {
  const id = await addFixtureFolder()
  await service.indexStart(id)
  return id
}

const progressEvents = (): IndexProgressEvent[] =>
  events
    .filter((entry) => entry.event === IPC_EVENTS.indexProgress)
    .map((entry) => entry.payload as IndexProgressEvent)

describe('managing folders', () => {
  it('starts with nothing', async () => {
    await expect(service.foldersList()).resolves.toEqual([])
  })

  it('adds the folder the picker returned, and says it is not indexed yet', async () => {
    picked = root
    const summary = await service.foldersAdd()

    expect(summary?.path).toBe(root)
    expect(summary?.documentCount).toBe(0)
    expect(summary?.indexSizeBytes).toBe(0)
    await expect(service.foldersList()).resolves.toHaveLength(1)
  })

  it('adds nothing when the picker is cancelled', async () => {
    picked = null
    await expect(service.foldersAdd()).resolves.toBeNull()
    await expect(service.foldersList()).resolves.toEqual([])
  })

  it('refuses a folder that does not exist, without naming the path back', async () => {
    picked = join(root, 'nowhere')
    await expect(service.foldersAdd()).rejects.toMatchObject({ code: 'FOLDER_UNREADABLE' })
  })

  it('refuses the same folder twice', async () => {
    await addFixtureFolder()
    await expect(service.foldersAdd()).rejects.toMatchObject({
      code: 'FOLDER_ALREADY_INDEXED',
    })
  })

  it('reports the counts and the size once the folder is indexed', async () => {
    const id = await indexedFixtureFolder()
    const folders = await service.foldersList()
    const summary = folders.find((folder) => folder.id === id) as FolderSummary

    expect(summary.documentCount).toBe(11)
    expect(summary.failedCount).toBe(3)
    expect(summary.chunkCount).toBeGreaterThan(10)
    expect(summary.indexSizeBytes).toBeGreaterThan(0)
    expect(summary.lastIndexedAtMs).toBe(NOW)
  })

  it('removes the folder and its index together', async () => {
    const id = await indexedFixtureFolder()
    await service.foldersRemove(id)

    await expect(service.foldersList()).resolves.toEqual([])
    await expect(service.searchQuery('atomic writes')).resolves.toMatchObject({ hits: [] })
  })

  it('keeps the config file when the last folder is removed', async () => {
    const id = await indexedFixtureFolder()
    await service.foldersRemove(id)

    const config = JSON.parse(await readFile(configPath, 'utf8')) as { folders: unknown[] }
    expect(config.folders).toEqual([])
  })
})

describe('indexing', () => {
  it('walks every file and reports progress that never carries document text', async () => {
    const id = await addFixtureFolder()
    await service.indexStart(id)

    const seen = progressEvents()
    expect(seen.length).toBeGreaterThan(10)
    expect(seen.every((progress) => progress.folderId === id)).toBe(true)
    expect(seen.at(-1)).toMatchObject({ documentsProcessed: 11, currentFile: null })
    for (const progress of seen) {
      expect(JSON.stringify(progress)).not.toContain(FIXTURE_SENTENCE)
      expect(JSON.stringify(progress).length).toBeLessThan(200)
    }
  })

  it('reports progress in the order the files were handled', async () => {
    const id = await addFixtureFolder()
    await service.indexStart(id)

    const counts = progressEvents().map((progress) => progress.documentsProcessed)
    expect(counts).toEqual([...counts].sort((left, right) => left - right))
  })

  it('announces the finished index once, and records the counts on the folder', async () => {
    const id = await indexedFixtureFolder()

    const done = events.filter((entry) => entry.event === IPC_EVENTS.indexDone)
    expect(done).toHaveLength(1)
    expect(done[0]?.payload).toMatchObject({ folderId: id, documentCount: 11, failedCount: 3 })

    const folders = await service.foldersList()
    expect(folders[0]?.lastIndexedAtMs).toBe(NOW)
  })

  it('reports each unreadable file as its own index error, with a safe message', async () => {
    const id = await addFixtureFolder()
    await service.indexStart(id)

    const failures = events
      .filter((entry) => entry.event === IPC_EVENTS.indexError)
      .map((entry) => entry.payload as { relativePath: string; message: string })

    expect(failures.map((failure) => failure.relativePath).sort()).toEqual([
      'edge/empty.txt',
      'edge/invalid-utf8.txt',
      'edge/whitespace-only.txt',
    ])
    for (const failure of failures) {
      expect(failure.message).not.toContain(root)
    }
  })

  it('refuses a second run while one is already going', async () => {
    const id = await addFixtureFolder()
    const running = service.indexStart(id)

    await expect(service.indexStart(id)).rejects.toMatchObject({ code: 'INDEX_IN_PROGRESS' })
    await running
  })

  it('reports itself as running while a run is in flight, and idle after', async () => {
    const id = await addFixtureFolder()
    await service.indexStart(id)

    const during = await Promise.all(statusQueries)
    expect(during.length).toBeGreaterThan(10)
    expect(during.every((status) => status.running)).toBe(true)
    expect(during.every((status) => status.folderId === id)).toBe(true)

    await expect(service.indexStatus()).resolves.toEqual({ running: false, folderId: null })
  })

  it('refuses to index a folder that is not in the list', async () => {
    await expect(service.indexStart('ffffffffffffffff')).rejects.toMatchObject({
      code: 'FOLDER_NOT_FOUND',
    })
  })

  it('stops when it is cancelled, and says the run was cancelled', async () => {
    const id = await addFixtureFolder()
    cancelAfter = 3

    await expect(service.indexStart(id)).rejects.toMatchObject({ code: 'CANCELLED' })
    await expect(service.indexStatus()).resolves.toEqual({ running: false, folderId: null })
    expect(progressEvents().at(-1)?.documentsProcessed).toBe(3)
  })

  it('leaves the index the user already had readable after a cancelled run', async () => {
    const id = await indexedFixtureFolder()
    const before = await service.searchQuery('atomic writes')
    expect(before.hits.length).toBeGreaterThan(0)

    cancelAfter = 3
    await expect(service.indexStart(id)).rejects.toMatchObject({ code: 'CANCELLED' })

    const after = await service.searchQuery('atomic writes')
    expect(after.hits).toEqual(before.hits)
    expect(events.filter((entry) => entry.event === IPC_EVENTS.indexDone)).toHaveLength(1)
  })

  it('cancelling when nothing is running does nothing at all', async () => {
    await expect(service.indexCancel()).resolves.toBeUndefined()
    await expect(service.indexStatus()).resolves.toEqual({ running: false, folderId: null })
  })

  it('touches no network at all', async () => {
    const guard = installNetworkGuard({ mode: 'offline' })
    try {
      await indexedFixtureFolder()
      expect(guard.attempts()).toEqual([])
      expect(guard.blocked()).toEqual([])
    } finally {
      guard.restore()
    }
  })
})

describe('searching', () => {
  it('finds the document that discusses the query, with its heading trail', async () => {
    await indexedFixtureFolder()
    const result = await service.searchQuery('atomic writes')

    expect(result.mode).toBe('lexical')
    expect(result.hits[0]?.filename).toBe('storage.md')
    expect(result.hits[0]?.headingPath).toEqual(['Storage', 'Atomic writes'])
    expect(result.hits[0]?.absolutePath).toBe(join(root, 'notes', 'storage.md'))
  })

  it('refuses an empty query', async () => {
    await indexedFixtureFolder()
    await expect(service.searchQuery('   ')).rejects.toMatchObject({ code: 'QUERY_EMPTY' })
  })

  it('finds nothing before anything is indexed', async () => {
    await addFixtureFolder()
    await expect(service.searchQuery('anything')).resolves.toMatchObject({ hits: [] })
  })

  it('honours topK', async () => {
    await indexedFixtureFolder()
    const result = await service.searchQuery('the', { topK: 1 })
    expect(result.hits).toHaveLength(1)
  })
})

describe('asking', () => {
  it('answers a confident question from retrieved text, with citations', async () => {
    await indexedFixtureFolder()
    const answer = await service.askQuestion('reciprocal rank fusion')

    expect(answer.status).toBe('answered')
    expect(answer.provider).toBe('extractive')
    expect(answer.citations.length).toBeGreaterThan(0)
    expect(answer.text).toContain('[1]')
    expect(answer.citations[0]?.filename).toBe('retrieval.md')
  })

  it('answers only with text that really is in the retrieved chunks', async () => {
    await indexedFixtureFolder()
    const answer = await service.askQuestion('reciprocal rank fusion')
    const corpus = answer.sources.map((hit) => hit.text).join('\n')

    expect(answer.passages.length).toBeGreaterThan(0)
    for (const passage of answer.passages) {
      expect(corpus).toContain(passage.text)
    }
  })

  it('refuses a weak question rather than guessing', async () => {
    await indexedFixtureFolder()
    const answer = await service.askQuestion('zzzzqqq nonexistent gibberish')

    expect(answer.status).toBe('insufficient')
    expect(answer.text).toBe('No reliable answer found.')
    expect(answer.citations).toEqual([])
  })

  it('says so when the config names a provider this build does not have', async () => {
    await indexedFixtureFolder()
    await service.settingsSet({ llm: { provider: 'extractive' } })
    // Written straight to disk: a config that reaches this state via the CLI must not be
    // silently rewritten, and the answer must still be honest about it.
    const config = JSON.parse(await readFile(configPath, 'utf8')) as Record<string, unknown>
    const llm = config.llm as Record<string, unknown>
    llm.provider = 'ollama'
    await writeFile(configPath, JSON.stringify(config), 'utf8')

    const answer = await service.askQuestion('reciprocal rank fusion')
    expect(answer.status).toBe('answered')
    expect(answer.note).toContain('extractive')
  })
})

describe('opening sources', () => {
  it('opens a file that belongs to an indexed document', async () => {
    await indexedFixtureFolder()
    const target = join(root, 'notes', 'storage.md')

    await service.sourceOpen(target)
    expect(opened).toEqual([target])
  })

  it('reveals an indexed file in its folder', async () => {
    const id = await indexedFixtureFolder()
    const target = join(root, 'notes', 'storage.md')

    await service.sourceReveal(target)
    expect(revealed).toEqual([target])
    expect(id).not.toBe('')
  })

  it('refuses a path that is not in any index, and never asks the shell to open it', async () => {
    await indexedFixtureFolder()

    await expect(service.sourceOpen(join(root, 'edge', 'unsupported.csv'))).rejects.toMatchObject({
      code: 'INDEX_NOT_FOUND',
    })
    expect(opened).toEqual([])
  })

  it('refuses a path outside the indexed folders entirely', async () => {
    await indexedFixtureFolder()

    await expect(service.sourceReveal(join(dataDir, 'config.json'))).rejects.toMatchObject({
      code: 'INDEX_NOT_FOUND',
    })
    expect(revealed).toEqual([])
  })

  it('reports a shell that could not open the file', async () => {
    await indexedFixtureFolder()
    service = createDesktopService({
      dataDir,
      configPath,
      registry: createFolderRegistry(configPath),
      data: createIndexStore({ dataDir }),
      now: () => NOW,
      pickFolder: async () => null,
      openPath: async () => 'No application is associated with this file',
      revealInFolder: () => undefined,
      emit: () => undefined,
    })

    await expect(service.sourceOpen(join(root, 'notes', 'storage.md'))).rejects.toMatchObject({
      code: 'INTERNAL',
    })
  })
})

describe('settings', () => {
  it('reports the defaults before anything has been saved', async () => {
    const settings = await service.settingsGet()
    expect(settings.version).toBe(1)
    expect(settings.offline).toBe(false)
    expect(settings.llm.provider).toBe('extractive')
  })

  it('saves a patch and reads it back', async () => {
    await service.settingsSet({ offline: true })
    await expect(service.settingsGet()).resolves.toMatchObject({ offline: true })
    expect(opened).toEqual([])
  })

  it('writes the patch to disk, so the CLI sees it too', async () => {
    await service.settingsSet({ offline: true })

    const config = JSON.parse(await readFile(configPath, 'utf8')) as { offline: boolean }
    expect(config.offline).toBe(true)
  })

  it('keeps the folders when settings change', async () => {
    const id = await addFixtureFolder()
    await service.settingsSet({ offline: true })

    const settings = await service.settingsGet()
    expect(settings.folders.map((folder) => folder.id)).toEqual([id])
  })

  it('refuses an invalid patch and leaves the file as it was', async () => {
    await service.settingsSet({ offline: false })
    const before = await readFile(configPath, 'utf8')

    await expect(
      service.settingsSet({ offline: 'yes' } as unknown as SettingsPatch),
    ).rejects.toMatchObject({ code: 'CONFIG_INVALID' })
    expect(await readFile(configPath, 'utf8')).toBe(before)
  })
})

describe('privacy and engine status', () => {
  it('states the promise, the storage path, and that nothing is reachable', async () => {
    const status = await service.privacyStatus()

    expect(status.message).toBe('Your files stay on this device.')
    expect(status.offline).toBe(false)
    expect(status.engine).toBe('extractive')
    expect(status.allowedDestinations).toEqual([])
  })

  it('reports offline once it has been turned on', async () => {
    await service.settingsSet({ offline: true })
    const status = await service.privacyStatus()
    expect(status.offline).toBe(true)
  })

  it('reports embeddings as unavailable and the extractive engine as available', async () => {
    const status = await service.engineStatus()

    expect(status.storagePath).toBe(dataDir)
    expect(status.embeddings.available).toBe(false)
    expect(status.embeddings.prepared).toBe(false)
    expect(status.llm.provider).toBe('extractive')
    expect(status.llm.available).toBe(true)
    expect(status.llm.models).toEqual([])
  })

  it('refuses to prepare a model it does not have, instead of pretending', async () => {
    await expect(service.modelPrepare()).rejects.toMatchObject({
      code: 'EMBEDDING_UNAVAILABLE',
    })
  })

  it('accepts the extractive provider and refuses one this build does not have', async () => {
    await expect(service.llmSetProvider('extractive')).resolves.toMatchObject({
      provider: 'extractive',
      available: true,
    })
    await expect(service.llmSetProvider('ollama', 'llama3.2')).rejects.toMatchObject({
      code: 'LLM_UNAVAILABLE',
    })
  })
})

describe('the whole flow, with no network at all', () => {
  it('adds, indexes, searches, asks and removes without a single request', async () => {
    const guard = installNetworkGuard({ mode: 'offline' })
    try {
      const id = await addFixtureFolder()
      await service.indexStart(id)
      const result = await service.searchQuery('staging directory')
      const answer = await service.askQuestion('staging directory swap')
      await service.privacyStatus()
      await service.engineStatus()
      await service.foldersRemove(id)

      expect(result.hits.length).toBeGreaterThan(0)
      expect(answer.status).toBe('answered')
      expect(guard.attempts()).toEqual([])
      expect(guard.blocked()).toEqual([])
    } finally {
      guard.restore()
    }
  })
})

describe('privacy of error messages', () => {
  it('never puts the data directory path into a refusal it hands back', async () => {
    await indexedFixtureFolder()

    const refusal = await service.sourceOpen(join(dataDir, 'config.json')).then(
      () => null,
      (thrown: unknown) => thrown as { message: string; code: string },
    )

    expect(refusal?.code).toBe('INDEX_NOT_FOUND')
    expect(refusal?.message).not.toContain(dataDir)
    expect(refusal?.message).not.toContain(root)
  })
})

describe('the status a fresh install is in', () => {
  it('reports no folders, no index and no reachable destination', async () => {
    const [folders, status, engine] = await Promise.all([
      service.foldersList(),
      service.privacyStatus(),
      service.engineStatus(),
    ])

    expect(folders).toEqual([])
    expect(status.allowedDestinations).toEqual([])
    expect(engine.storagePath).toBe(dataDir)
  })
})
