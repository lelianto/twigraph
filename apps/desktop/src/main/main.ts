import { join } from 'node:path'

import { BrowserWindow, Menu, app, ipcMain, session } from 'electron'

import { createIndexStore } from '@twigraph/indexing'
import { createFolderRegistry } from '@twigraph/shared'

import { APP_ID } from './app-identity'
import { registerIpc } from './ipc'
import { createPlatform, resolveDesktopPaths } from './platform'
import { createDesktopService } from './service'
import { createWindowOptions } from './window-options'

function createWindow(): BrowserWindow {
  const window = new BrowserWindow(
    createWindowOptions({
      preloadPath: join(__dirname, 'preload.cjs'),
      iconPath: join(__dirname, 'logo.png'),
    }),
  )

  window.once('ready-to-show', () => {
    window.show()
    window.focus()
  })

  // Guarantee window is visible even if ready-to-show is delayed by the compositor
  setTimeout(() => {
    if (!window.isDestroyed() && !window.isVisible()) {
      window.show()
      window.focus()
    }
  }, 400)

  // This window shows one local page and nothing else: no new windows and no navigating away,
  // so a stray link cannot turn the app into a browser.
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => {
    event.preventDefault()
  })

  void window.loadFile(join(__dirname, 'renderer', 'index.html'))

  if (process.env.TWIGRAPH_DEVTOOLS === '1') {
    window.webContents.openDevTools({ mode: 'detach' })
  }

  return window
}

function start(): void {
  const paths = resolveDesktopPaths()
  const window = createWindow()
  const platform = createPlatform(window)

  const service = createDesktopService({
    dataDir: paths.dataDir,
    configPath: paths.configPath,
    data: createIndexStore({ dataDir: paths.dataDir }),
    registry: createFolderRegistry(paths.configPath),
    pickFolder: () => platform.pickFolder(),
    openPath: (absolutePath) => platform.openPath(absolutePath),
    revealInFolder: (absolutePath) => {
      platform.revealInFolder(absolutePath)
    },
    offline: paths.offline,
    emit: (event, payload) => {
      // An index run can outlive the window it was started from.
      if (!window.isDestroyed()) window.webContents.send(event, payload)
    },
  })

  registerIpc(ipcMain, service)

  // Removed because it is Electron's chrome, not twigraph's. `TWIGRAPH_DEVTOOLS=1` is the
  // development way back in.
  Menu.setApplicationMenu(null)
}

/** No page here has a reason to ask for a camera, a microphone, notifications, or anything else. */
function denyEveryPermission(): void {
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => {
    callback(false)
  })
  session.defaultSession.setPermissionCheckHandler(() => false)
}

// Two windows writing the same index would race for no benefit, so a second launch brings the
// first one forward instead of opening a rival.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const [existing] = BrowserWindow.getAllWindows()
    if (existing === undefined) return
    if (existing.isMinimized()) existing.restore()
    existing.focus()
  })

  app
    .whenReady()
    .then(() => {
      // Before any window exists, and matching what the installer wrote into the shortcut that
      // started this process: Windows groups a taskbar button by this id, so a window without it
      // is a second button rather than the one the user pinned.
      app.setAppUserModelId(APP_ID)
      denyEveryPermission()
      start()
    })
    .catch((error: unknown) => {
      // Nothing is listening yet, so this is the only place a startup failure can be reported.
      process.stderr.write(`twigraph could not start: ${String(error)}\n`)
      app.exit(1)
    })

  app.on('window-all-closed', () => {
    // Windows only for now, so there is no platform that keeps an app alive without windows.
    app.quit()
  })
}
