import { existsSync, readdirSync, rmSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * The desktop app as an installer and a portable zip.
 *
 * `apps/desktop/electron-builder.yml` holds the configuration; the configuration lives there
 * rather than here because electron-builder reads it, and because it is the file a person edits
 * when they want a different installer. This script is the part that runs it and then refuses to
 * call the result a success without looking: an electron-builder that exits zero having written
 * nothing would otherwise be indistinguishable from one that worked.
 */

if (process.platform !== 'win32') {
  throw new Error(
    `the desktop app is packaged for Windows, and this machine is ${process.platform}`,
  )
}

const appDir = resolve('apps/desktop')
const outDir = resolve(appDir, 'release')

/**
 * electron-builder empties its output directory before it starts and gives up if it cannot, which
 * on Windows can be for a reason that has nothing to do with the app: a search indexer, a file
 * watcher or a security product holding a handle on the previous build. Doing the deletion here,
 * where there is room to explain it, turns a bare `EBUSY` into something actionable — and the
 * failure repeats identically on every later run, so it is worth saying why.
 */
function clearOutput() {
  if (!existsSync(outDir)) return
  try {
    rmSync(outDir, { recursive: true, force: true })
  } catch (error) {
    throw new Error(
      `could not remove ${outDir}, so there is nothing to package into:\n  ${String(error)}\n` +
        'Something outside this build holds a file in there. Closing whatever watches this folder, ' +
        'excluding it from Windows Search indexing and from any antivirus, or restarting, releases it.',
    )
  }
}

// Dynamic, because the platform check above has to run first: a static import is evaluated
// before this module's own body, which would build the bundles on a machine that cannot be
// packaged for anyway. `build-desktop.mjs` is awaited as a module for the side effect that is
// its whole job.
await import('./build-desktop.mjs')

clearOutput()

const { build } = await import('electron-builder')
await build({ projectDir: appDir })

const names = readdirSync(outDir)
const installers = names.filter((name) => name.endsWith('-setup.exe'))
const zips = names.filter((name) => name.endsWith('.zip'))

function requireFile(file, label) {
  if (!existsSync(file) || statSync(file).size === 0) {
    throw new Error(`${label} was not produced, expected a non-empty ${file}`)
  }
}

if (installers.length === 0) throw new Error(`no NSIS installer in ${outDir}`)
if (zips.length === 0) throw new Error(`no portable zip in ${outDir}`)

requireFile(resolve(outDir, installers[0]), 'the NSIS installer')
requireFile(resolve(outDir, zips[0]), 'the portable zip')
requireFile(resolve(outDir, 'win-unpacked', 'twigraph.exe'), 'the unpacked application')

process.stdout.write(`packaged ${[...installers, ...zips].sort().join(', ')}\n`)
