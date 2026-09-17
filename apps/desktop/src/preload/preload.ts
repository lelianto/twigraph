import { contextBridge, ipcRenderer } from 'electron'

import { createTwigraphApi } from './api'

/**
 * The only bridge between the window and the main process.
 *
 * The renderer runs sandboxed with context isolation on and no Node integration, so this is
 * the entire surface it can reach: the named channels in `@twigraph/shared/ipc`, and nothing
 * else. No filesystem, no network, no generic invoke.
 */
contextBridge.exposeInMainWorld('twigraph', createTwigraphApi(ipcRenderer))
