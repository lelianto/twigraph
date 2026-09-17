import { describe, expect, it } from 'vitest'

import { IPC_CHANNELS, IPC_EVENTS } from '@twigraph/shared/ipc'
import type { IpcEvent } from '@twigraph/shared/ipc'

import { createTwigraphApi } from '../src/preload/api'
import type { IpcRendererLike } from '../src/preload/api'

interface Recorded {
  readonly channel: string
  readonly args: readonly unknown[]
}

/**
 * The smallest thing that behaves like `ipcRenderer`: it records what was asked for and can
 * push an event back, which is all the preload is allowed to depend on.
 */
function fakeRenderer(): {
  readonly renderer: IpcRendererLike
  readonly calls: Recorded[]
  readonly listeners: Map<string, Set<(event: unknown, ...args: unknown[]) => void>>
  readonly emit: (channel: IpcEvent, payload: unknown) => void
} {
  const calls: Recorded[] = []
  const listeners = new Map<string, Set<(event: unknown, ...args: unknown[]) => void>>()

  return {
    calls,
    listeners,
    renderer: {
      invoke: async (channel: string, ...args: unknown[]): Promise<unknown> => {
        calls.push({ channel, args })
        return { ok: true, value: `${channel}-result` }
      },
      on: (channel, listener) => {
        const forChannel = listeners.get(channel) ?? new Set()
        forChannel.add(listener)
        listeners.set(channel, forChannel)
      },
      removeListener: (channel, listener) => {
        listeners.get(channel)?.delete(listener)
      },
    },
    emit: (channel, payload) => {
      for (const listener of [...(listeners.get(channel) ?? [])])
        listener({ sender: 'main' }, payload)
    },
  }
}

const CHANNEL_NAMES = Object.values(IPC_CHANNELS)

describe('the shape of window.twigraph', () => {
  it('exposes the groups the contract declares, and nothing else', () => {
    const api = createTwigraphApi(fakeRenderer().renderer)

    expect(Object.keys(api).sort()).toEqual([
      'ask',
      'engine',
      'folders',
      'index',
      'llm',
      'on',
      'privacy',
      'search',
      'settings',
      'sources',
    ])
    expect(Object.keys(api.folders).sort()).toEqual(['add', 'list', 'remove'])
    expect(Object.keys(api.index).sort()).toEqual(['cancel', 'start', 'status'])
    expect(Object.keys(api.search)).toEqual(['query'])
    expect(Object.keys(api.ask)).toEqual(['question'])
    expect(Object.keys(api.sources).sort()).toEqual(['open', 'reveal'])
    expect(Object.keys(api.settings).sort()).toEqual(['get', 'set'])
    expect(Object.keys(api.privacy)).toEqual(['status'])
    expect(Object.keys(api.engine).sort()).toEqual(['prepareModel', 'status'])
    expect(Object.keys(api.llm)).toEqual(['setProvider'])
    expect(Object.keys(api.on).sort()).toEqual([
      'askChunk',
      'indexDone',
      'indexError',
      'indexProgress',
    ])
  })

  it('offers no way to reach a channel that is not on the list', () => {
    const api = createTwigraphApi(fakeRenderer().renderer)

    // There is no `invoke`, no `send`, and no method that takes a channel name.
    expect(Object.keys(api)).not.toContain('invoke')
    expect(Object.keys(api)).not.toContain('send')
    expect(Object.keys(api)).not.toContain('channel')
    for (const group of Object.values(api)) {
      expect(Object.values(group).every((member) => typeof member === 'function')).toBe(true)
    }
  })
})

describe('calling the main process', () => {
  it('uses every named channel in the contract, and only those', async () => {
    const { renderer, calls } = fakeRenderer()
    const api = createTwigraphApi(renderer)

    await api.folders.list()
    await api.folders.add()
    await api.folders.remove('folder-id')
    await api.index.start('folder-id')
    await api.index.cancel()
    await api.index.status()
    await api.search.query('a query')
    await api.ask.question('a question')
    await api.sources.open('C:\\notes\\a.md')
    await api.sources.reveal('C:\\notes\\a.md')
    await api.settings.get()
    await api.settings.set({ offline: true })
    await api.privacy.status()
    await api.engine.status()
    await api.engine.prepareModel()
    await api.llm.setProvider('extractive')

    const used = calls.map((call) => call.channel)
    expect(new Set(used).size).toBe(16)
    expect([...used].sort()).toEqual([...CHANNEL_NAMES].sort())
  })

  it('passes a folder id to the channel that needs one', async () => {
    const { renderer, calls } = fakeRenderer()
    const api = createTwigraphApi(renderer)

    await api.folders.remove('abc123')
    await api.index.start('abc123')

    expect(calls).toEqual([
      { channel: IPC_CHANNELS.foldersRemove, args: ['abc123'] },
      { channel: IPC_CHANNELS.indexStart, args: ['abc123'] },
    ])
  })

  it('leaves out an argument the caller did not give', async () => {
    const { renderer, calls } = fakeRenderer()
    const api = createTwigraphApi(renderer)

    await api.search.query('a query')
    await api.search.query('a query', { topK: 3 })
    await api.llm.setProvider('extractive')
    await api.llm.setProvider('extractive', 'llama3.2')

    expect(calls).toEqual([
      { channel: IPC_CHANNELS.searchQuery, args: ['a query'] },
      { channel: IPC_CHANNELS.searchQuery, args: ['a query', { topK: 3 }] },
      { channel: IPC_CHANNELS.llmSetProvider, args: ['extractive'] },
      { channel: IPC_CHANNELS.llmSetProvider, args: ['extractive', 'llama3.2'] },
    ])
  })

  it('hands the result straight back, including a failure', async () => {
    const failure = { ok: false, error: { code: 'QUERY_EMPTY', message: 'Enter something' } }
    const api = createTwigraphApi({
      invoke: async () => failure,
      on: () => undefined,
      removeListener: () => undefined,
    })

    await expect(api.search.query('  ')).resolves.toEqual(failure)
  })
})

describe('listening for events', () => {
  it('delivers the payload and not the Electron event object', () => {
    const { renderer, emit } = fakeRenderer()
    const api = createTwigraphApi(renderer)
    const seen: unknown[] = []

    api.on.indexProgress((event) => seen.push(event))
    emit(IPC_EVENTS.indexProgress, { folderId: 'abc123', documentsProcessed: 2 })

    expect(seen).toEqual([{ folderId: 'abc123', documentsProcessed: 2 }])
  })

  it('subscribes to each of the four events on its own channel', () => {
    const { renderer, listeners } = fakeRenderer()
    const api = createTwigraphApi(renderer)

    api.on.indexProgress(() => undefined)
    api.on.indexError(() => undefined)
    api.on.indexDone(() => undefined)
    api.on.askChunk(() => undefined)

    expect([...listeners.keys()].sort()).toEqual(Object.values(IPC_EVENTS).sort())
  })

  it('unsubscribes the very listener it added, and can be called twice', () => {
    const { renderer, listeners, emit } = fakeRenderer()
    const api = createTwigraphApi(renderer)
    const seen: unknown[] = []

    const off = api.on.indexDone((manifest) => seen.push(manifest))
    expect(listeners.get(IPC_EVENTS.indexDone)?.size).toBe(1)

    off()
    expect(listeners.get(IPC_EVENTS.indexDone)?.size).toBe(0)
    expect(() => off()).not.toThrow()

    emit(IPC_EVENTS.indexDone, { folderId: 'abc123' })
    expect(seen).toEqual([])
  })

  it('lets two subscribers unsubscribe independently', () => {
    const { renderer, listeners, emit } = fakeRenderer()
    const api = createTwigraphApi(renderer)
    const first: unknown[] = []
    const second: unknown[] = []

    const offFirst = api.on.indexError((failure) => first.push(failure))
    api.on.indexError((failure) => second.push(failure))
    offFirst()
    emit(IPC_EVENTS.indexError, { relativePath: 'edge/empty.txt' })

    expect(first).toEqual([])
    expect(second).toEqual([{ relativePath: 'edge/empty.txt' }])
    expect(listeners.get(IPC_EVENTS.indexError)?.size).toBe(1)
  })
})
