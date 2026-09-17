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

/** Electron ships the executable's name in a file rather than exporting a path. */
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
    expect(binary, 'run npm install: the Electron binary is missing').not.toBeNull()
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
        readonly rail: { readonly width: number } | null
        readonly inspector: { readonly width: number } | null
        readonly status: { readonly height: number } | null
      }
      readonly ledger: {
        readonly lines: number
        readonly markers: number
        readonly threads: number
        readonly text: string | null
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

    // The three panes are really laid out side by side, rather than the window being one column
    // that happens to scroll.
    expect(probe.layout.columns).toBe('236px 594px 336px')
    expect(probe.layout.rail?.width).toBe(236)
    expect(probe.layout.inspector?.width).toBe(336)
    expect(probe.layout.status?.height).toBe(34)

    // An answer was asked for and the ledger drew it: two sentences, each with the source it
    // came from in the gutter beside it.
    expect(probe.ledger.lines).toBe(2)
    expect(probe.ledger.markers).toBe(2)
    expect(probe.ledger.threads).toBe(2)
    expect(probe.ledger.text).toContain('reciprocal rank fusion')

    // The screenshot is for a person to look at; its existence is what the test can check.
    expect(existsSync(SHOT), 'the probe left no screenshot behind').toBe(true)
    expect(statSync(SHOT).size).toBeGreaterThan(10_000)
  }, 120_000)
})
