import type { BrowserWindowConstructorOptions } from 'electron'

export interface WindowPaths {
  /** The bundled preload, beside this file in `dist/`. */
  readonly preloadPath: string
  readonly iconPath: string
}

/**
 * The window this app is allowed to open.
 *
 * Deliberately a pure function of its paths, so the security posture can be asserted in a test
 * without launching Electron: context isolation on, no Node in the renderer, sandbox on. The
 * page carries the matching Content-Security-Policy.
 */
export function createWindowOptions(paths: WindowPaths): BrowserWindowConstructorOptions {
  return {
    width: 1180,
    height: 780,
    minWidth: 880,
    minHeight: 600,
    // The colour the page paints, so the first frame is not a white flash.
    backgroundColor: '#07110d',
    show: false,
    title: 'twigraph',
    icon: paths.iconPath,
    webPreferences: {
      preload: paths.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  }
}
