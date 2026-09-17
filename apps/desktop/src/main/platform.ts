import { join } from 'node:path'

import { dialog, shell } from 'electron'
import type { BrowserWindow } from 'electron'

import { isOffline, resolveDataDir } from '../../../cli/src/paths'

/**
 * Where the desktop app keeps its data.
 *
 * Deliberately the same resolution the CLI and the MCP server use, including
 * `TWIGRAPH_DATA_DIR`, so a folder indexed from the command line is searchable in the window
 * without copying anything.
 */
export interface DesktopPaths {
  readonly dataDir: string
  readonly configPath: string
  readonly offline: boolean
}

export function resolveDesktopPaths(env: NodeJS.ProcessEnv = process.env): DesktopPaths {
  const dataDir = resolveDataDir(undefined, env)
  return { dataDir, configPath: join(dataDir, 'config.json'), offline: isOffline(env) }
}

/** The impure half of the service: a native picker and the user's shell. */
export interface DesktopPlatform {
  pickFolder(): Promise<string | null>
  openPath(absolutePath: string): Promise<string>
  revealInFolder(absolutePath: string): void
}

export function createPlatform(window: BrowserWindow): DesktopPlatform {
  return {
    pickFolder: async (): Promise<string | null> => {
      const result = await dialog.showOpenDialog(window, {
        title: 'Choose a folder to index',
        buttonLabel: 'Add folder',
        properties: ['openDirectory'],
      })
      return result.canceled ? null : (result.filePaths[0] ?? null)
    },
    // Both of these resolve an already-validated path: the service refuses any path that is
    // not part of an index the user built.
    openPath: (absolutePath: string): Promise<string> => shell.openPath(absolutePath),
    revealInFolder: (absolutePath: string): void => {
      shell.showItemInFolder(absolutePath)
    },
  }
}
