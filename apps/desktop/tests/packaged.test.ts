import { spawn } from 'node:child_process'
import {
  closeSync,
  existsSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * The opt-in check on the packaged application.
 *
 * It exists because packaging is where a working checkout stops being a working download, and
 * because nothing else here would notice: `desktop.smoke.test.ts` runs the preload and the page
 * from a plain directory, with a stub main process, so it passes just as happily against an
 * installer that would open a blank window. What is checked instead is the shape of what gets
 * shipped — that the archive holds the whole bundle and nothing from the workspace, and that the
 * executable starts — which is what catches a `files` list that quietly dropped the renderer.
 *
 * It is not proof that the installed window renders. `main.ts` is glue that no test in this
 * repository executes; the only check that covers it is opening the installed application by
 * hand, and the README says so rather than implying otherwise.
 *
 *   npm run package:desktop
 *   $env:TWIGRAPH_DESKTOP_PACKAGED='1'
 *   npx vitest run apps/desktop/tests/packaged.test.ts --no-coverage
 */

const ENABLED = process.env.TWIGRAPH_DESKTOP_PACKAGED === '1'
const REPO = fileURLToPath(new URL('../../../', import.meta.url))
const APP = join(REPO, 'apps', 'desktop')
const RELEASE = join(APP, 'release')
const UNPACKED = join(RELEASE, 'win-unpacked')
const ASAR = join(UNPACKED, 'resources', 'app.asar')
const EXE = join(UNPACKED, 'twigraph.exe')

/** The files the window cannot open without. A missing one is a blank window, not an error. */
const REQUIRED = [
  'package.json',
  'dist/main.cjs',
  'dist/preload.cjs',
  'dist/logo.png',
  'dist/renderer/index.html',
  'dist/renderer/app.css',
  'dist/renderer/renderer.js',
  'dist/renderer/logo.png',
].sort()

interface AsarEntry {
  readonly files?: Record<string, AsarEntry>
}

/**
 * The paths inside an asar archive, without a dependency for reading one.
 *
 * The archive opens with two length-prefixed headers and then the file data. The first eight
 * bytes are a pickle holding one number: the byte length of the second, which follows from
 * offset eight. That second header is a pickle itself — four bytes of payload length, then the
 * byte length of the JSON directory, then the JSON — so the directory starts at offset eight of
 * it, not at its beginning.
 */
function asarEntries(archive: string): string[] {
  const handle = openSync(archive, 'r')
  try {
    const prefix = Buffer.alloc(8)
    readSync(handle, prefix, 0, 8, 0)
    const headerSize = prefix.readUInt32LE(4)
    const header = Buffer.alloc(headerSize)
    readSync(handle, header, 0, headerSize, 8)

    const jsonSize = header.readUInt32LE(4)
    const directory = JSON.parse(header.subarray(8, 8 + jsonSize).toString('utf8')) as AsarEntry

    const paths: string[] = []
    const walk = (node: AsarEntry, parent: string): void => {
      for (const [name, child] of Object.entries(node.files ?? {})) {
        const path = parent === '' ? name : `${parent}/${name}`
        if (child.files === undefined) paths.push(path)
        else walk(child, path)
      }
    }
    walk(directory, '')
    return paths.sort()
  } finally {
    closeSync(handle)
  }
}

describe.skipIf(!ENABLED || !existsSync(ASAR))(
  'the packaged desktop app, in the archive that would be downloaded',
  () => {
    it('ships the whole bundle, and nothing of the workspace it was built from', () => {
      const entries = asarEntries(ASAR)

      for (const path of REQUIRED) {
        expect(entries, `${path} is not in the archive`).toContain(path)
      }

      // The three @twigraph packages are devDependencies because esbuild already folded them
      // into the bundles. If they ever reappear here, sources and tests are being shipped.
      expect(entries.filter((path) => path.startsWith('node_modules/'))).toEqual([])
      expect(
        entries.filter((path) => path.startsWith('src/') || path.startsWith('tests/')),
      ).toEqual([])
    })

    it('points Electron at the bundled main process rather than a source file', () => {
      const manifest = JSON.parse(readFileSync(join(APP, 'package.json'), 'utf8')) as {
        main?: string
      }
      expect(manifest.main).toBe('dist/main.cjs')
    })

    it('leaves an installer, a zip, and an unpacked application behind', () => {
      const names = readdirSync(RELEASE)
      const installers = names.filter((name) => name.endsWith('-setup.exe'))
      const zips = names.filter((name) => name.endsWith('.zip'))

      expect(installers).toEqual([`twigraph-${appVersion()}-x64-setup.exe`])
      expect(zips).toEqual([`twigraph-${appVersion()}-x64.zip`])

      const size = existsSync(EXE) ? statSync(EXE).size : 0
      expect(size, `${EXE} is missing or empty`).toBeGreaterThan(0)
    })

    it('starts without the main process reporting that it could not', async () => {
      // Its own profile, for the same reason the smoke test uses one: the single-instance lock
      // lives in the user data directory, and a copy of the app already running on this machine
      // would otherwise make this instance quit on purpose and look like a failure.
      const profile = mkdtempSync(join(tmpdir(), 'twigraph-packaged-profile-'))
      const child = spawn(EXE, [`--user-data-dir=${profile}`, '--disable-gpu'], {
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      let stderr = ''
      let exitCode: number | null = null
      child.stderr.setEncoding('utf8')
      child.stderr.on('data', (chunk: string) => {
        stderr += chunk
      })
      child.on('exit', (code) => {
        exitCode = code ?? -1
      })

      try {
        await new Promise((resolve) => setTimeout(resolve, 6_000))
        expect(stderr).not.toContain('twigraph could not start')
        expect(exitCode, 'the application exited while starting up').toBeNull()
      } finally {
        if (exitCode === null) {
          child.kill()
          // Bounded, so a process that ignores the signal fails the test rather than hanging it.
          await Promise.race([
            new Promise((resolve) => child.once('exit', resolve)),
            new Promise((resolve) => setTimeout(resolve, 5_000)),
          ])
        }
        rmSync(profile, { recursive: true, force: true })
      }
    }, 60_000)
  },
)

function appVersion(): string {
  return (JSON.parse(readFileSync(join(APP, 'package.json'), 'utf8')) as { version: string })
    .version
}
