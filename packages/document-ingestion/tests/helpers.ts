import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import type { ParseInput } from '@twigraph/shared'

export async function makeTempDir(prefix = 'twigraph-ingestion-'): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix))
}

/** Writes a fixture and returns its absolute path. */
export async function writeFixture(
  root: string,
  relativePath: string,
  content: string | Uint8Array,
): Promise<string> {
  const absolutePath = join(root, relativePath)
  await mkdir(dirname(absolutePath), { recursive: true })
  await writeFile(absolutePath, content)
  return absolutePath
}

/** The `ParseInput` a scanner would have produced for a file already on disk. */
export async function parseInputFor(root: string, relativePath: string): Promise<ParseInput> {
  const absolutePath = join(root, relativePath)
  const info = await stat(absolutePath)
  const bytes = await readFile(absolutePath)
  return {
    absolutePath,
    relativePath,
    sizeBytes: info.size,
    modifiedAtMs: Math.trunc(info.mtimeMs),
    contentHash: createHash('sha256').update(bytes).digest('hex'),
  }
}
