import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { generateFixtures } from '../../../fixtures/generate.mjs'
import { createFolderRegistry } from '@twigraph/shared'
import { IPC_CHANNELS, IPC_EVENTS } from '@twigraph/shared/ipc'
import { createIndexStore } from '@twigraph/indexing'

import { registerIpc } from '../src/main/ipc'
import { createDesktopService } from '../src/main/service'
import type { DesktopService } from '../src/main/service'

const CHANNEL_NAMES = Object.values(IPC_CHANNELS)

let root = ''
let dataDir = ''
let configPath = ''
let service: DesktopService
let registered: Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>

/**
 * A stand-in for Electron's `ipcMain`. Stubbing Electron is an allowed I/O boundary; the
 * service behind it is the real one, over a real data directory and real fixtures.
 */
function install(): {
  readonly call: (channel: string, ...args: unknown[]) => Promise<unknown>
} {
  registered = new Map()
  registerIpc(
    {
      handle: (channel, listener) => {
        registered.set(channel, listener)
      },
    },
    service,
  )
  return {
    call: async (channel: string, ...args: unknown[]): Promise<unknown> => {
      const listener = registered.get(channel)
      if (listener === undefined) throw new Error(`no handler was registered for ${channel}`)
      return listener({ sender: 'renderer' }, ...args)
    },
  }
}

interface Failure {
  readonly ok: false
  readonly error: { readonly code: string; readonly message: string }
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'twigraph-ipc-src-'))
  dataDir = await mkdtemp(join(tmpdir(), 'twigraph-ipc-data-'))
  await generateFixtures(root)
  configPath = join(dataDir, 'config.json')

  service = createDesktopService({
    dataDir,
    configPath,
    registry: createFolderRegistry(configPath),
    data: createIndexStore({ dataDir }),
    now: () => 1_700_000_000_000,
    pickFolder: async () => root,
    openPath: async () => '',
    revealInFolder: () => undefined,
    emit: () => undefined,
  })
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
  await rm(dataDir, { recursive: true, force: true })
})

describe('the channels that get registered', () => {
  it('registers exactly the contract, and nothing else', () => {
    install()
    expect([...registered.keys()].sort()).toEqual([...CHANNEL_NAMES].sort())
    expect(registered.size).toBe(16)
  })

  it('does not register an event name as an invokable channel', () => {
    install()
    for (const event of Object.values(IPC_EVENTS)) {
      expect(registered.has(event)).toBe(false)
    }
  })
})

describe('answering the renderer', () => {
  it('answers a real request with the value the service produced', async () => {
    const { call } = install()
    const result = await call(IPC_CHANNELS.foldersList)

    expect(result).toEqual({ ok: true, value: [] })
  })

  it('runs a real index run through the channel', async () => {
    const { call } = install()
    const added = (await call(IPC_CHANNELS.foldersAdd)) as { ok: true; value: { id: string } }
    const result = await call(IPC_CHANNELS.indexStart, added.value.id)

    expect(result).toEqual({ ok: true, value: undefined })

    const found = (await call(IPC_CHANNELS.searchQuery, 'atomic writes')) as {
      ok: true
      value: { hits: { filename: string }[] }
    }
    expect(found.value.hits[0]?.filename).toBe('storage.md')
  })

  it('turns a refusal into a failure the renderer can show', async () => {
    const { call } = install()
    const result = (await call(IPC_CHANNELS.indexStart, 'ffffffffffffffff')) as unknown as Failure

    expect(result.ok).toBe(false)
    expect(result.error.code).toBe('FOLDER_NOT_FOUND')
    expect(result.error.message).toBe('No folder in the list has that id')
  })

  it('never lets a stack cross the boundary', async () => {
    const { call } = install()
    const result = (await call(IPC_CHANNELS.searchQuery, '   ')) as unknown as Failure

    expect(result.ok).toBe(false)
    expect(Object.keys(result).sort()).toEqual(['error', 'ok'])
    expect(
      Object.keys(result.error).every((key) => ['code', 'message', 'detail'].includes(key)),
    ).toBe(true)
    expect(JSON.stringify(result)).not.toContain('stack')
    expect(JSON.stringify(result)).not.toContain('at ')
  })

  it('does not reject, whatever the service does', async () => {
    const { call } = install()
    const withArgs: Record<string, readonly unknown[]> = {
      [IPC_CHANNELS.foldersRemove]: ['ffffffffffffffff'],
      [IPC_CHANNELS.indexStart]: ['ffffffffffffffff'],
      [IPC_CHANNELS.searchQuery]: ['anything'],
      [IPC_CHANNELS.askQuestion]: ['anything'],
      [IPC_CHANNELS.sourceOpen]: ['C:\\nowhere.md'],
      [IPC_CHANNELS.sourceReveal]: ['C:\\nowhere.md'],
      [IPC_CHANNELS.settingsSet]: [{}],
      [IPC_CHANNELS.llmSetProvider]: ['extractive'],
    }

    for (const channel of CHANNEL_NAMES) {
      const result = (await call(channel, ...(withArgs[channel] ?? []))) as { ok: boolean }
      expect(typeof result.ok, channel).toBe('boolean')
    }
  })
})

describe('arguments that arrive from the renderer', () => {
  it('refuses an argument that is not text, without passing it to the engine', async () => {
    const { call } = install()
    const added = (await call(IPC_CHANNELS.foldersAdd)) as { ok: true; value: { id: string } }

    const result = (await call(IPC_CHANNELS.foldersRemove, 42)) as unknown as Failure
    expect(result.ok).toBe(false)
    expect(result.error.code).toBe('INTERNAL')

    // The folder is still there: the bad call never reached the registry.
    const folders = (await call(IPC_CHANNELS.foldersList)) as {
      ok: true
      value: { id: string }[]
    }
    expect(folders.value.map((folder) => folder.id)).toEqual([added.value.id])
  })

  it('refuses a provider this build does not know', async () => {
    const { call } = install()
    const result = (await call(
      IPC_CHANNELS.llmSetProvider,
      'some-cloud-thing',
    )) as unknown as Failure

    expect(result.ok).toBe(false)
    expect(result.error.code).toBe('INTERNAL')
  })

  it('refuses search options that are not a count', async () => {
    const { call } = install()
    const result = (await call(IPC_CHANNELS.searchQuery, 'anything', {
      topK: 'lots',
    })) as unknown as Failure

    expect(result.ok).toBe(false)
    expect(result.error.message).toBe('The search options were not valid')
  })

  it('refuses a settings patch that is not an object', async () => {
    const { call } = install()
    const result = (await call(IPC_CHANNELS.settingsSet, 'offline')) as unknown as Failure

    expect(result.ok).toBe(false)
    expect(result.error.code).toBe('INTERNAL')
  })
})

describe('a throw that is not ours', () => {
  it('becomes a generic internal error, without leaking the raw message', async () => {
    service = createDesktopService({
      dataDir,
      configPath,
      registry: createFolderRegistry(configPath),
      data: createIndexStore({ dataDir }),
      now: () => 1_700_000_000_000,
      pickFolder: async () => root,
      // A native call blowing up is exactly the shape of failure the boundary exists for.
      openPath: async () => {
        throw new Error('EPERM: operation not permitted, open C:\\Users\\me\\private.md')
      },
      revealInFolder: () => undefined,
      emit: () => undefined,
    })
    const { call } = install()

    const added = (await call(IPC_CHANNELS.foldersAdd)) as { ok: true; value: { id: string } }
    await call(IPC_CHANNELS.indexStart, added.value.id)

    const result = (await call(
      IPC_CHANNELS.sourceOpen,
      join(root, 'notes', 'storage.md'),
    )) as unknown as Failure

    expect(result.ok).toBe(false)
    expect(result.error).toEqual({ code: 'INTERNAL', message: 'Unexpected internal error' })
    expect(JSON.stringify(result)).not.toContain('private.md')
  })
})
