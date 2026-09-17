import { chmod, mkdir, rm } from 'node:fs/promises'
import { resolve } from 'node:path'

import { build } from 'esbuild'

const outputDirectory = resolve('dist')
const outputFile = resolve(outputDirectory, 'cli.js')

await rm(outputDirectory, { recursive: true, force: true })
await mkdir(outputDirectory, { recursive: true })

await build({
  entryPoints: [resolve('apps/cli/src/main.ts')],
  outfile: outputFile,
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  banner: { js: '#!/usr/bin/env node' },
  legalComments: 'none',
  sourcemap: false,
})

await chmod(outputFile, 0o755)
