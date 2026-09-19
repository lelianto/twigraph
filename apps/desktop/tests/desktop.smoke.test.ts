import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * The opt-in desktop smoke test.
 *
 * Everything else about the desktop app is tested headlessly. This is the only check that runs
 * a real Electron process, and it is here because the guarantees live between files rather than
 * inside one: that the page's Content-Security-Policy lets its own bundle run, that the renderer
 * has no Node in it, that a network request from the page is actually refused, that the sandboxed
 * preload reaches the main process, and that the answer ledger — the window's whole idea — draws
 * its sources beside the sentences that came from them.
 *
 * It leaves a screenshot behind as well, because the one thing a test cannot judge is how it looks:
 *
 *   $env:TWIGRAPH_DESKTOP_SMOKE='1'
 *   npm run build:desktop
 *   npx vitest run apps/desktop/tests/desktop.smoke.test.ts --no-coverage
 *
 * Skipped by default: it launches a browser engine, which would make the everyday suite slow
 * and machine-dependent.
 */

const ENABLED = process.env.TWIGRAPH_DESKTOP_SMOKE === '1'
const REPO = fileURLToPath(new URL('../../../', import.meta.url))
const DIST = join(REPO, 'apps', 'desktop', 'dist')
const HARNESS = join(REPO, 'apps', 'desktop', 'tests', 'harness', 'main.cjs')
const SHOT = join(tmpdir(), 'twigraph-desktop-smoke.png')

/**
 * Electron ships the executable's name in a file rather than exporting a path.
 *
 * This reads that file directly, which is why it can come up empty on a clean checkout: Electron
 * 44 has no `postinstall` and downloads its binary the first time something requires the package,
 * so nothing has needed it yet. The build and release paths fill it in with
 * `node node_modules/electron/install.js`; this is only a test, and it says so rather than
 * reaching for the network.
 */
function electronBinary(): string | null {
  const pathFile = join(REPO, 'node_modules', 'electron', 'path.txt')
  if (!existsSync(pathFile)) return null
  const binary = join(
    REPO,
    'node_modules',
    'electron',
    'dist',
    readFileSync(pathFile, 'utf8').trim(),
  )
  return existsSync(binary) ? binary : null
}

function lineAfter(output: string, prefix: string): unknown {
  const line = output.split('\n').find((entry) => entry.startsWith(prefix))
  if (line === undefined) throw new Error(`the probe never printed ${prefix}:\n${output}`)
  return JSON.parse(line.slice(prefix.length))
}

describe.skipIf(!ENABLED)('the desktop window, in a real Electron process', () => {
  it('mounts the page, keeps Node out, refuses the network, and reaches the main process', () => {
    const binary = electronBinary()
    expect(
      binary,
      'the Electron binary is missing: run node node_modules/electron/install.js',
    ).not.toBeNull()
    expect(existsSync(join(DIST, 'preload.cjs')), 'run npm run build:desktop').toBe(true)
    expect(existsSync(join(DIST, 'renderer', 'index.html')), 'run npm run build:desktop').toBe(true)

    const profile = mkdtempSync(join(tmpdir(), 'twigraph-smoke-profile-'))
    const run = spawnSync(binary as string, [HARNESS, DIST, SHOT], {
      encoding: 'utf8',
      timeout: 120_000,
      env: {
        ...process.env,
        // Its own Chromium profile: a development copy of the app may be running against the
        // default one, and two instances sharing a disk cache cannot both be driven.
        TWIGRAPH_SMOKE_USER_DATA: profile,
      },
    })
    // The profile only has to outlive the process that used it.
    rmSync(profile, { recursive: true, force: true })

    const output = `${run.stdout ?? ''}\n${run.stderr ?? ''}`

    const probe = lineAfter(output, 'PROBE ') as {
      readonly apiGroups: readonly string[]
      readonly eventListeners: readonly string[]
      readonly mountedNodes: number
      readonly hasNode: boolean
      readonly networkRefused: boolean
      readonly policyViolations: readonly string[]
      readonly layout: {
        readonly columns: string
        readonly rail: { readonly x: number; readonly width: number } | null
        readonly canvas: { readonly x: number; readonly width: number } | null
        readonly inspector: { readonly x: number; readonly width: number } | null
        readonly status: { readonly height: number } | null
        readonly documentOverflow: boolean
      }
      readonly ledger: {
        readonly lines: number
        readonly markers: number
        readonly threads: number
        readonly text: string | null
      }
      readonly brandMark: { readonly tag: string; readonly naturalWidth: number } | null
      readonly panels: {
        readonly before: { readonly rail: number; readonly inspector: number }
        readonly minimized: {
          readonly rail: number
          readonly inspector: number
          readonly foldersHidden: boolean
          readonly labels: readonly string[]
        }
        readonly restored: { readonly rail: number; readonly inspector: number }
      }
      readonly semantics: {
        readonly queryLabel: string | null
        readonly folderSelectorTag: string | null
        readonly folderActions: readonly { readonly text: string; readonly visible: boolean }[]
        readonly sourceText: string
        readonly dialogOpen: boolean
        readonly dialogFocused: boolean
        readonly dialogFocusReturned: boolean
      }
      readonly privacy: { readonly ok: boolean }
      readonly folders: { readonly ok: boolean }
    }

    // The preload exposed the whole contract to the page.
    expect(probe.apiGroups).toEqual([
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
    expect(probe.eventListeners).toEqual(['askChunk', 'indexDone', 'indexError', 'indexProgress'])

    // React mounted, which could only happen if the policy let the page load its own bundle.
    expect(probe.mountedNodes).toBeGreaterThan(10)

    // The window is a page, not a Node process.
    expect(probe.hasNode).toBe(false)

    // A network request from the page is refused, and the refusal is the policy's doing.
    expect(probe.networkRefused).toBe(true)
    expect(probe.policyViolations).toContain('connect-src')

    // A call went out over IPC and an answer came back.
    expect(probe.privacy.ok).toBe(true)
    expect(probe.folders.ok).toBe(true)

    const calls = lineAfter(output, 'CALLS ') as readonly string[]
    expect(calls).toContain('folders:list')
    expect(calls).toContain('engine:status')
    expect(calls).toContain('privacy:status')
    expect(calls).toContain('settings:get')
    expect(calls).toContain('ask:question')

    // Wide mode keeps the working field between a folder navigator and the evidence inspector.
    expect(probe.layout.columns.split(' ')).toHaveLength(3)
    expect(probe.layout.rail?.width).toBeGreaterThanOrEqual(220)
    expect(probe.layout.canvas?.width).toBeGreaterThanOrEqual(400)
    expect(probe.layout.inspector?.width).toBeGreaterThanOrEqual(320)
    expect((probe.layout.rail?.x ?? -1) + (probe.layout.rail?.width ?? 0)).toBe(
      probe.layout.canvas?.x,
    )
    expect((probe.layout.canvas?.x ?? -1) + (probe.layout.canvas?.width ?? 0)).toBe(
      probe.layout.inspector?.x,
    )
    expect(probe.layout.status?.height).toBeGreaterThanOrEqual(40)
    expect(probe.layout.documentOverflow).toBe(false)

    // The rail shows the shipped logo, and the page's policy let it load: an image the policy
    // refused would be a broken icon that every measurement above still calls correct.
    expect(probe.brandMark?.tag).toBe('IMG')
    expect(probe.brandMark?.naturalWidth).toBeGreaterThan(0)

    // Both side panels minimize to a spine, give their room to the answer, and come back from the
    // same button — the layout control a person uses rather than reads.
    expect(probe.panels.before.rail).toBeGreaterThanOrEqual(220)
    expect(probe.panels.before.inspector).toBeGreaterThanOrEqual(320)
    expect(probe.panels.minimized.rail).toBeLessThanOrEqual(42)
    expect(probe.panels.minimized.inspector).toBeLessThanOrEqual(42)
    expect(probe.panels.minimized.foldersHidden).toBe(true)
    expect(probe.panels.minimized.labels).toEqual(['Show evidence', 'Show folders'])
    expect(probe.panels.restored.rail).toBe(probe.panels.before.rail)
    expect(probe.panels.restored.inspector).toBe(probe.panels.before.inspector)

    // The primary controls are semantic and visible without depending on hover.
    expect(probe.semantics.queryLabel).toBe('Ask or search your indexed files')
    expect(probe.semantics.folderSelectorTag).toBe('BUTTON')
    expect(probe.semantics.folderActions.map((action) => action.text)).toEqual([
      'Re-index',
      'Remove',
    ])
    expect(probe.semantics.folderActions.every((action) => action.visible)).toBe(true)

    // An answer was asked for and the ledger drew it: two sentences, each with the source it
    // came from in the gutter beside it.
    expect(probe.ledger.lines).toBe(2)
    expect(probe.ledger.markers).toBe(2)
    expect(probe.ledger.threads).toBe(2)
    expect(probe.ledger.text).toContain('reciprocal rank fusion')
    expect(probe.semantics.sourceText).toContain('Source [1]')
    expect(probe.semantics.sourceText).toContain('retrieval.md')
    expect(probe.semantics.dialogOpen).toBe(true)
    expect(probe.semantics.dialogFocused).toBe(true)
    expect(probe.semantics.dialogFocusReturned).toBe(true)

    const compact = lineAfter(output, 'COMPACT ') as {
      readonly columns: string
      readonly inspectorPosition: string | null
      readonly inspectorVisible: boolean
      readonly inspectorMinimizeHidden: boolean | null
      readonly documentOverflow: boolean
    }
    expect(compact.columns.split(' ')).toHaveLength(2)
    expect(compact.inspectorPosition).toBe('fixed')
    expect(compact.inspectorVisible).toBe(true)
    // The overlay is put away by its Close button, so the minimize control is not offered here.
    expect(compact.inspectorMinimizeHidden).toBe(true)
    expect(compact.documentOverflow).toBe(false)

    // The screenshot is for a person to look at; its existence is what the test can check.
    expect(existsSync(SHOT), 'the probe left no screenshot behind').toBe(true)
    expect(statSync(SHOT).size).toBeGreaterThan(10_000)
  }, 120_000)
})
