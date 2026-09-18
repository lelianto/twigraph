/**
 * The Electron probe behind the opt-in desktop smoke test.
 *
 * It runs the real preload and the real built page in a real (hidden) Electron window, with a
 * stub main process, and reports what it observed as JSON on stdout. That is the only way to
 * check the things that live between the files: that the page's Content-Security-Policy lets
 * its own bundle run, that the renderer has no Node in it, that a network request from the page
 * is actually refused, and that the preload's `window.twigraph` reaches the main process.
 *
 * Usage: electron harness/main.cjs <absolute path to apps/desktop/dist>
 */

const { BrowserWindow, app, ipcMain } = require('electron')
const { writeFile } = require('node:fs/promises')
const { join } = require('node:path')

const DIST = process.argv[2]
/** Optional: a path to write a screenshot of the window after driving one query. */
const SHOT = process.argv[3]
const calls = []

const HIT = {
  chunkId: '6fa170768c2f2b6d:1',
  documentId: '6fa170768c2f2b6d',
  filename: 'retrieval.md',
  absolutePath: 'C:\\notes\\retrieval.md',
  headingPath: ['Retrieval', 'Fusion'],
  excerpt:
    'Rank lists are combined with reciprocal rank fusion: each retriever contributes 1 / (k + rank); k is 60.',
  text: 'Fusion\n\nRank lists are combined with reciprocal rank fusion: each retriever contributes 1 / (k + rank); k is 60; raw scores are never added together.',
  score: 0.8,
  ranks: { bm25: 0 },
}

const ANSWER = {
  status: 'answered',
  text: 'Rank lists are combined with reciprocal rank fusion: each retriever contributes 1 / (k + rank). [1]\n\nRaw scores are never added together. [2]',
  passages: [],
  citations: [
    {
      marker: 1,
      chunkId: HIT.chunkId,
      filename: HIT.filename,
      absolutePath: HIT.absolutePath,
      headingPath: HIT.headingPath,
      excerpt: HIT.excerpt,
    },
    {
      marker: 2,
      chunkId: 'aaaa1111bbbb2222:3',
      filename: 'storage.md',
      absolutePath: 'C:\\notes\\storage.md',
      page: 4,
      pageEnd: 6,
      headingPath: ['Storage', 'Atomic writes'],
      excerpt: 'A write goes to a temporary file and is then renamed into place.',
    },
  ],
  provider: 'extractive',
  unverifiedMarkers: [],
  sources: [HIT],
}

/** The channels the window calls. */
const responses = {
  // One indexed folder, so the window is in the state a user would actually be in rather than
  // showing the first-run empty state.
  'folders:list': {
    ok: true,
    value: [
      {
        id: '7c5ff45cf68f1b5a',
        path: 'C:\\notes',
        addedAtMs: 1_700_000_000_000,
        lastIndexedAtMs: 1_700_000_000_000,
        documentCount: 11,
        chunkCount: 18,
        failedCount: 3,
        indexSizeBytes: 27238,
      },
    ],
  },
  'ask:question': { ok: true, value: ANSWER },
  'search:query': {
    ok: true,
    value: { query: 'rank fusion', mode: 'lexical', hits: [HIT], tookMs: 4 },
  },
  'engine:status': {
    ok: true,
    value: {
      embeddings: {
        available: false,
        prepared: false,
        enabled: true,
        modelId: 'Xenova/all-MiniLM-L6-v2',
        label: 'not in this build',
      },
      llm: {
        provider: 'extractive',
        available: true,
        label: 'Extractive (Local)',
        model: null,
        models: [],
      },
      storagePath: 'C:\\probe-data',
    },
  },
  'privacy:status': {
    ok: true,
    value: {
      message: 'Your files stay on this device.',
      offline: false,
      engine: 'extractive',
      allowedDestinations: [],
    },
  },
  'settings:get': {
    ok: true,
    value: {
      version: 1,
      folders: [],
      offline: false,
      retrieval: { topK: 8, minScore: 0.35, rrfK: 60, bm25: { k1: 1.2, b: 0.75 } },
      chunking: { targetTokens: 900, overlapRatio: 0.12 },
      embeddings: { enabled: true, modelId: 'Xenova/all-MiniLM-L6-v2', dtype: 'q8' },
      llm: {
        provider: 'extractive',
        ollama: {
          baseUrl: 'http://127.0.0.1:11434',
          model: '',
          timeoutMs: 60000,
          numCtx: 4096,
        },
      },
    },
  },
}

for (const [channel, response] of Object.entries(responses)) {
  ipcMain.handle(channel, () => {
    calls.push(channel)
    return response
  })
}

/** The page runs this in its own world. Everything here is what the window can actually do. */
const PROBE = `(async () => {
  const api = window.twigraph
  const root = document.getElementById('root')

  // The policy says connect-src 'none'. If this resolves, the policy is not doing its job.
  const policyViolations = []
  document.addEventListener('securitypolicyviolation', (event) => {
    policyViolations.push(event.violatedDirective)
  })

  let networkRefused = false
  try {
    await fetch('http://example.com/')
  } catch {
    networkRefused = true
  }

  // Where the three panes actually landed, so a broken layout fails the test rather than
  // being something only an eye would catch.
  const box = (selector) => {
    const element = document.querySelector(selector)
    if (element === null) return null
    const rect = element.getBoundingClientRect()
    return { x: Math.round(rect.x), width: Math.round(rect.width), height: Math.round(rect.height) }
  }
  const layout = {
    viewport: { width: window.innerWidth, height: window.innerHeight },
    columns: getComputedStyle(document.querySelector('.app')).gridTemplateColumns,
    rail: box('.pane--rail'),
    canvas: box('.canvas'),
    inspector: box('.pane--inspector'),
    status: box('.status'),
    documentOverflow: document.documentElement.scrollWidth > window.innerWidth,
  }

  const query = document.querySelector('#query')
  const queryLabel = query?.labels?.[0]?.textContent?.trim() ?? null
  const folderSelector = document.querySelector('.folder__select')
  const folderActions = [...document.querySelectorAll('.folder__actions button')].map((button) => ({
    text: button.textContent?.trim() ?? '',
    visible: getComputedStyle(button).visibility !== 'hidden' && getComputedStyle(button).display !== 'none',
  }))
  const source = document.querySelector('[data-source-inspector]')
  const sourceText = source?.textContent ?? ''

  // The rail's brand mark is a shipped image rather than a drawn glyph, so whether it drew at all
  // depends on the page's policy letting the file load — a failure no layout measurement sees.
  // Wait for the load to settle first, or a slow one would be reported as a broken icon.
  const mark = document.querySelector('.rail__mark')
  if (mark !== null && !mark.complete) {
    await new Promise((resolve) => {
      mark.addEventListener('load', resolve, { once: true })
      mark.addEventListener('error', resolve, { once: true })
    })
  }
  const brandMark = mark === null ? null : { tag: mark.tagName, naturalWidth: mark.naturalWidth }

  const settingsTrigger = [...document.querySelectorAll('.status button')].find((button) =>
    button.textContent?.includes('Settings and privacy'),
  )
  settingsTrigger?.click()
  await new Promise((resolve) => setTimeout(resolve, 50))
  const dialog = document.querySelector('dialog.settings')
  const dialogOpen = dialog?.open === true
  const dialogFocused = dialog?.contains(document.activeElement) === true
  dialog?.querySelector('button')?.click()
  await new Promise((resolve) => setTimeout(resolve, 50))
  const dialogFocusReturned = document.activeElement === settingsTrigger

  // The answer, if one was asked for: the ledger is the whole idea of the window, so a count of
  // its lines and markers is worth asserting on.
  const ledger = {
    lines: document.querySelectorAll('.ledger__line').length,
    markers: document.querySelectorAll('.ledger__marker').length,
    threads: document.querySelectorAll('.ledger__thread').length,
    text: document.querySelector('.ledger__text')?.textContent ?? null,
  }

  // The side panels, driven last: minimizing them moves the columns every measurement above
  // describes, and the window is expected to be back in its starting layout when this returns.
  const widthOf = (selector) => {
    const element = document.querySelector(selector)
    return element === null ? -1 : Math.round(element.getBoundingClientRect().width)
  }
  const clickToggle = (label) => {
    document.querySelector('.pane__toggle[aria-label="' + label + '"]')?.click()
  }

  // This window is hidden, and a hidden Chromium window does not advance transitions: a width
  // read while one is in flight stays at its starting size for good. The destination is what is
  // being checked here, so the journey is switched off for the measurement.
  const noMotion = document.createElement('style')
  noMotion.textContent = '* { transition: none !important }'
  document.head.append(noMotion)

  await new Promise((resolve) => setTimeout(resolve, 60))
  const panelsBefore = { rail: widthOf('.pane--rail'), inspector: widthOf('.pane--inspector') }

  clickToggle('Hide folders')
  clickToggle('Hide evidence')
  await new Promise((resolve) => setTimeout(resolve, 400))
  const railList = document.querySelector('.rail__list')
  const panelsMinimized = {
    rail: widthOf('.pane--rail'),
    inspector: widthOf('.pane--inspector'),
    foldersHidden: railList !== null && getComputedStyle(railList).display === 'none',
    labels: [...document.querySelectorAll('.pane__toggle')]
      .map((button) => button.getAttribute('aria-label'))
      .sort(),
  }

  clickToggle('Show folders')
  clickToggle('Show evidence')
  await new Promise((resolve) => setTimeout(resolve, 400))
  const panelsRestored = { rail: widthOf('.pane--rail'), inspector: widthOf('.pane--inspector') }
  noMotion.remove()

  const privacy = await api.privacy.status()
  const folders = await api.folders.list()

  return JSON.stringify({
    apiGroups: Object.keys(api).sort(),
    eventListeners: Object.keys(api.on).sort(),
    mountedNodes: root === null ? -1 : root.querySelectorAll('*').length,
    hasNode: typeof require !== 'undefined' || typeof process !== 'undefined',
    networkRefused,
    policyViolations,
    layout,
    ledger,
    brandMark,
    panels: { before: panelsBefore, minimized: panelsMinimized, restored: panelsRestored },
    semantics: {
      queryLabel,
      folderSelectorTag: folderSelector?.tagName ?? null,
      folderActions,
      sourceText,
      dialogOpen,
      dialogFocused,
      dialogFocusReturned,
    },
    privacy,
    folders,
  })
})()`

/**
 * Types a question and presses Ask, so the bundle can be photographed in the state that matters
 * most: an answer with its sources in the gutter beside it.
 *
 * React tracks an input's value itself, so the native setter is used to make the change visible
 * to it — assigning to `.value` alone would leave React believing the box is still empty.
 */
async function driveOneAsk(window) {
  await window.webContents.executeJavaScript(`(() => {
    const input = document.querySelector('.ask__input')
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setValue.call(input, 'reciprocal rank fusion')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })()`)

  await new Promise((resolve) => setTimeout(resolve, 250))
  // The submit button, not the "Ask" mode chip that carries the same label.
  await window.webContents.executeJavaScript(
    `document.querySelector('.ask .button--primary').click()`,
  )
  await new Promise((resolve) => setTimeout(resolve, 700))
  await window.webContents.executeJavaScript(`document.querySelector('.ledger__marker')?.click()`)
  await new Promise((resolve) => setTimeout(resolve, 150))
}

// Chromium keeps its disk cache under `userData`. A development copy of the app may be running
// against that same default path, and two instances sharing one cache is what produces
// "Access is denied" and a renderer that cannot be driven, so the test hands this one its own.
if (process.env.TWIGRAPH_SMOKE_USER_DATA !== undefined) {
  app.setPath('userData', process.env.TWIGRAPH_SMOKE_USER_DATA)
}

app.commandLine.appendSwitch('disable-gpu')

app
  .whenReady()
  .then(async () => {
    // The same size the real window opens at, so the layout that is measured here is the
    // layout the app actually shows. A hidden window cannot be photographed, which is the only
    // reason the screenshot mode shows it.
    const window = new BrowserWindow({
      width: 1180,
      height: 780,
      show: SHOT !== undefined,
      webPreferences: {
        preload: join(DIST, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    })

    // The single-argument form: passing the legacy (event, level, message) triple warns on
    // Electron 44 and is going away.
    window.webContents.on('console-message', (event) => {
      process.stdout.write(`CONSOLE ${String(event.level)} ${String(event.message)}\n`)
    })
    window.webContents.on('did-fail-load', (_event, code, description) => {
      process.stdout.write(`LOADFAILED ${code} ${description}\n`)
    })

    try {
      await window.loadFile(join(DIST, 'renderer', 'index.html'))

      if (
        process.env.TWIGRAPH_SMOKE_THEME === 'light' ||
        process.env.TWIGRAPH_SMOKE_THEME === 'dark'
      ) {
        await window.webContents.executeJavaScript(
          `document.documentElement.dataset.theme = ${JSON.stringify(process.env.TWIGRAPH_SMOKE_THEME)}`,
        )
      }

      if (SHOT !== undefined) {
        process.stdout.write('STAGE drive\n')
        await driveOneAsk(window)
        process.stdout.write('STAGE capture\n')
        const image = await window.webContents.capturePage()
        await writeFile(SHOT, image.toPNG())
        process.stdout.write(`SHOT ${SHOT}\n`)
      }

      process.stdout.write('STAGE probe\n')
      const observed = JSON.parse(await window.webContents.executeJavaScript(PROBE))
      process.stdout.write(`PROBE ${JSON.stringify(observed)}\n`)

      window.setSize(880, 600)
      await new Promise((resolve) => setTimeout(resolve, 150))
      const compact = await window.webContents.executeJavaScript(`(() => {
        const inspector = document.querySelector('[data-source-inspector]')
        const rect = inspector?.getBoundingClientRect()
        const minimize = document.querySelector('.pane--inspector .pane__toggle')
        return {
          viewport: { width: window.innerWidth, height: window.innerHeight },
          columns: getComputedStyle(document.querySelector('.app')).gridTemplateColumns,
          inspectorPosition: inspector === null ? null : getComputedStyle(inspector).position,
          inspectorVisible: rect === undefined ? false : rect.right <= window.innerWidth && rect.left >= 0,
          inspectorMinimizeHidden: minimize === null ? null : getComputedStyle(minimize).display === 'none',
          documentOverflow: document.documentElement.scrollWidth > window.innerWidth,
        }
      })()`)
      process.stdout.write(`COMPACT ${JSON.stringify(compact)}\n`)
      process.stdout.write(`CALLS ${JSON.stringify([...calls].sort())}\n`)
      app.exit(0)
    } catch (error) {
      process.stdout.write(`PROBEFAILED ${String(error)}\n`)
      app.exit(1)
    }
  })
  .catch((error) => {
    process.stdout.write(`PROBEFAILED ${String(error)}\n`)
    app.exit(1)
  })
