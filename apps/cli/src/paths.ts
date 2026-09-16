import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

export const DATA_DIR_VARIABLE = 'MULAT_DATA_DIR'
export const OFFLINE_VARIABLE = 'MULAT_OFFLINE'

/**
 * Where mulat keeps everything when the user has not said otherwise.
 *
 * One directory, in the place each platform expects application data to live, so the user
 * can find it, look inside it, and delete it.
 */
export function defaultDataDir(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): string {
  if (platform === 'win32') {
    const localAppData = env.LOCALAPPDATA
    return join(
      localAppData === undefined || localAppData === ''
        ? join(home, 'AppData', 'Local')
        : localAppData,
      'mulat',
    )
  }
  if (platform === 'darwin') {
    return join(home, 'Library', 'Application Support', 'mulat')
  }
  const xdg = env.XDG_DATA_HOME
  return join(xdg === undefined || xdg === '' ? join(home, '.local', 'share') : xdg, 'mulat')
}

export function resolveDataDir(
  explicit: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (explicit !== undefined && explicit !== '') return resolve(explicit)
  const fromEnvironment = env[DATA_DIR_VARIABLE]
  if (fromEnvironment !== undefined && fromEnvironment !== '') return resolve(fromEnvironment)
  return defaultDataDir(process.platform, env)
}

export function isOffline(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env[OFFLINE_VARIABLE]
  return value === '1' || value === 'true'
}
