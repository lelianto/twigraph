import { TwigraphError, toWireError } from '@twigraph/shared'
import type { AnswerProviderId, SearchOptions } from '@twigraph/shared'
import { IPC_CHANNELS } from '@twigraph/shared/ipc'
import type { IpcChannel, IpcResult, SettingsPatch } from '@twigraph/shared/ipc'

import type { DesktopService } from './service'

/**
 * The Electron API this module needs, described structurally so a test can hand it a plain
 * object instead of a real `ipcMain`.
 */
export interface IpcMainLike {
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => Promise<unknown>): void
}

type Handler = (...args: unknown[]) => Promise<unknown>

function asText(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new TwigraphError('INTERNAL', `The ${label} was not text`)
  }
  return value
}

function asObject(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TwigraphError('INTERNAL', `The ${label} was not an object`)
  }
  return value as Record<string, unknown>
}

function asSearchOptions(value: unknown): SearchOptions | undefined {
  if (value === undefined) return undefined
  const raw = asObject(value, 'search options')
  if (raw.topK === undefined) return {}
  if (typeof raw.topK !== 'number' || !Number.isInteger(raw.topK) || raw.topK < 1) {
    throw new TwigraphError('INTERNAL', 'The search options were not valid')
  }
  return { topK: raw.topK }
}

function asProvider(value: unknown): AnswerProviderId {
  if (value !== 'extractive' && value !== 'ollama') {
    throw new TwigraphError('INTERNAL', 'That answer provider is not one this build knows')
  }
  return value
}

function asOptionalText(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined
  return asText(value, label)
}

/**
 * Wires the service onto the named channels.
 *
 * Two rules hold for every handler:
 *
 * 1. the arguments arrive from the renderer, so they are checked before the engine sees
 *    them — a folder id that is not a string never reaches the registry;
 * 2. a throw never crosses the boundary. Every outcome becomes an `IpcResult`, which is why
 *    the renderer has no stack to trip over and no error path of its own to get wrong.
 *
 * The channel set is a `Record` over `IpcChannel`, so leaving one unimplemented is a
 * compile error rather than a missing handler at runtime.
 */
export function registerIpc(ipcMain: IpcMainLike, service: DesktopService): void {
  const handlers: Readonly<Record<IpcChannel, Handler>> = {
    [IPC_CHANNELS.foldersList]: () => service.foldersList(),
    [IPC_CHANNELS.foldersAdd]: () => service.foldersAdd(),
    [IPC_CHANNELS.foldersRemove]: (folderId) =>
      service.foldersRemove(asText(folderId, 'folder id')),
    [IPC_CHANNELS.indexStart]: (folderId) => service.indexStart(asText(folderId, 'folder id')),
    [IPC_CHANNELS.indexCancel]: () => service.indexCancel(),
    [IPC_CHANNELS.indexStatus]: () => service.indexStatus(),
    [IPC_CHANNELS.searchQuery]: (query, options) =>
      service.searchQuery(asText(query, 'query'), asSearchOptions(options)),
    [IPC_CHANNELS.askQuestion]: (question) => service.askQuestion(asText(question, 'question')),
    [IPC_CHANNELS.sourceOpen]: (absolutePath) => service.sourceOpen(asText(absolutePath, 'path')),
    [IPC_CHANNELS.sourceReveal]: (absolutePath) =>
      service.sourceReveal(asText(absolutePath, 'path')),
    [IPC_CHANNELS.settingsGet]: () => service.settingsGet(),
    // Shallow check only: the service validates the merged config with the same parser the
    // config file is read with, so a bad field becomes CONFIG_INVALID rather than a bad file.
    [IPC_CHANNELS.settingsSet]: (patch) =>
      service.settingsSet(asObject(patch, 'settings patch') as SettingsPatch),
    [IPC_CHANNELS.privacyStatus]: () => service.privacyStatus(),
    [IPC_CHANNELS.engineStatus]: () => service.engineStatus(),
    [IPC_CHANNELS.modelPrepare]: () => service.modelPrepare(),
    [IPC_CHANNELS.llmSetProvider]: (provider, model) =>
      service.llmSetProvider(asProvider(provider), asOptionalText(model, 'model')),
  }

  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.handle(channel, async (_event, ...args: unknown[]): Promise<IpcResult<unknown>> => {
      try {
        return { ok: true, value: await handler(...args) }
      } catch (error) {
        return { ok: false, error: toWireError(error) }
      }
    })
  }
}
