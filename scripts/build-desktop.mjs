import { copyFile, mkdir, readFile, rm } from 'node:fs/promises'
import { resolve } from 'node:path'

import { build } from 'esbuild'

/**
 * The desktop bundle: a CommonJS main process, a CommonJS preload, and one browser script for
 * the page.
 *
 * The two CommonJS outputs are not a preference: a preload under `sandbox: true` has to be
 * CommonJS, and the main process is loaded by Electron's own CJS loader.
 */

const outDir = resolve('apps/desktop/dist')
const rendererDir = resolve(outDir, 'renderer')
const rendererSource = resolve('apps/desktop/src/renderer')

const SHARED = {
  bundle: true,
  legalComments: 'none',
  sourcemap: false,
  target: 'node22',
}

await rm(outDir, { recursive: true, force: true })
await mkdir(rendererDir, { recursive: true })

await build({
  ...SHARED,
  entryPoints: [resolve('apps/desktop/src/main/main.ts')],
  outfile: resolve(outDir, 'main.cjs'),
  format: 'cjs',
  platform: 'node',
  external: ['electron'],
})

await build({
  ...SHARED,
  entryPoints: [resolve('apps/desktop/src/preload/preload.ts')],
  outfile: resolve(outDir, 'preload.cjs'),
  format: 'cjs',
  platform: 'node',
  external: ['electron'],
})

// `platform: 'browser'` is itself part of the guarantee: if the page ever imported a Node
// built-in, this build would fail to resolve it rather than quietly shipping it.
await build({
  entryPoints: [resolve('apps/desktop/src/renderer/main.tsx')],
  outfile: resolve(rendererDir, 'renderer.js'),
  bundle: true,
  legalComments: 'none',
  sourcemap: false,
  format: 'iife',
  platform: 'browser',
  target: 'chrome120',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
})

/**
 * The page and the preload run without a filesystem, so neither may carry a Node built-in into
 * the window. `platform: 'browser'` catches the page; this catches the preload, which is built
 * for Node and would otherwise bundle one in without complaint.
 */
async function assertNoNodeBuiltins(file, label) {
  const text = await readFile(file, 'utf8')
  if (/require\(["']node:|from ["']node:/.test(text)) {
    throw new Error(`${label} reached a Node built-in, which it must not`)
  }
}

await assertNoNodeBuiltins(resolve(outDir, 'preload.cjs'), 'the preload')
await assertNoNodeBuiltins(resolve(rendererDir, 'renderer.js'), 'the renderer')

await copyFile(resolve(rendererSource, 'index.html'), resolve(rendererDir, 'index.html'))
await copyFile(resolve(rendererSource, 'app.css'), resolve(rendererDir, 'app.css'))
await copyFile(resolve('assets/twigraph-logo.png'), resolve(outDir, 'logo.png'))
