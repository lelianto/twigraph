import { rm } from 'node:fs/promises'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { TwigraphError } from '@twigraph/shared'

import { generateFixtures } from '../../../fixtures/generate.mjs'
import { createParserRegistry, defaultParsers } from '../src/registry'
import { scanFolder } from '../src/scan'
import { makeTempDir, writeFixture } from './helpers'

const SUPPORTED = createParserRegistry(defaultParsers()).extensions

let root = ''

beforeAll(async () => {
  root = await makeTempDir('twigraph-scan-')
  await generateFixtures(root)
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('scanning a folder', () => {
  it('finds every supported file and nothing else', async () => {
    const result = await scanFolder(root, { supportedExtensions: SUPPORTED })

    expect(result.files).toHaveLength(11)
    expect(result.files.map((file) => file.relativePath)).toEqual([
      'deep/one/two/nested.md',
      'edge/empty.txt',
      'edge/headings-only.md',
      'edge/invalid-utf8.txt',
      'edge/nested-list.md',
      'edge/whitespace-only.txt',
      'notes/long.md',
      'notes/retrieval.md',
      'notes/storage.md',
      'plain/embeddings.txt',
      'plain/privacy.txt',
    ])
  })

  it('refuses to walk into dependency, version-control and hidden directories', async () => {
    const result = await scanFolder(root, { supportedExtensions: SUPPORTED })
    const paths = result.files.map((file) => file.relativePath)

    expect(paths.some((path) => path.includes('node_modules'))).toBe(false)
    expect(paths.some((path) => path.includes('.git/'))).toBe(false)
    expect(paths.some((path) => path.startsWith('.hidden/'))).toBe(false)
  })

  it('reports every entry it declined, so nothing goes missing without a reason', async () => {
    const result = await scanFolder(root, { supportedExtensions: SUPPORTED })

    expect(result.skipped).toEqual([
      { relativePath: '.git', reason: 'ignored-directory' },
      { relativePath: '.hidden', reason: 'hidden' },
      { relativePath: 'edge/no-extension', reason: 'unsupported-extension' },
      { relativePath: 'edge/unsupported.csv', reason: 'unsupported-extension' },
      { relativePath: 'node_modules', reason: 'ignored-directory' },
    ])
  })

  it('reports a declined directory once rather than once per file inside it', async () => {
    const deep = await makeTempDir('twigraph-scan-deep-')
    try {
      await writeFixture(deep, 'node_modules/pkg/a/i.md', '# a')
      await writeFixture(deep, 'node_modules/pkg/b/i.md', '# b')
      await writeFixture(deep, 'kept.md', '# kept')

      const result = await scanFolder(deep, { supportedExtensions: SUPPORTED })

      expect(result.skipped).toEqual([
        { relativePath: 'node_modules', reason: 'ignored-directory' },
      ])
      expect(result.files.map((file) => file.relativePath)).toEqual(['kept.md'])
    } finally {
      await rm(deep, { recursive: true, force: true })
    }
  })

  it('reports a hidden file as well as a hidden directory', async () => {
    const hidden = await makeTempDir('twigraph-scan-hidden-')
    try {
      await writeFixture(hidden, '.env.txt', 'SECRET=1')
      await writeFixture(hidden, 'visible.md', '# visible')

      const result = await scanFolder(hidden, { supportedExtensions: SUPPORTED })

      expect(result.skipped).toEqual([{ relativePath: '.env.txt', reason: 'hidden' }])
      expect(result.files.map((file) => file.relativePath)).toEqual(['visible.md'])
    } finally {
      await rm(hidden, { recursive: true, force: true })
    }
  })

  it('accepts every extension when no filter is given, but still refuses hidden entries', async () => {
    const result = await scanFolder(root)

    expect(result.files.map((file) => file.relativePath)).toContain('edge/unsupported.csv')
    expect(result.skipped.map((entry) => entry.reason)).toEqual([
      'ignored-directory',
      'hidden',
      'ignored-directory',
    ])
  })

  it('reports a file above the size limit rather than reading it', async () => {
    const result = await scanFolder(root, { supportedExtensions: SUPPORTED, maxFileSizeBytes: 16 })

    // Only three fixtures fit under 16 bytes: nothing (0), the invalid bytes (9) and the
    // whitespace-only file (10).
    expect(result.files.map((file) => file.relativePath)).toEqual([
      'edge/empty.txt',
      'edge/invalid-utf8.txt',
      'edge/whitespace-only.txt',
    ])
    expect(result.skipped.filter((entry) => entry.reason === 'too-large')).toHaveLength(8)
    expect(result.skipped.filter((entry) => entry.reason === 'unsupported-extension')).toHaveLength(
      2,
    )
  })

  it('gives every file a lowercase extension, a content hash and a slash separated path', async () => {
    const result = await scanFolder(root, { supportedExtensions: SUPPORTED })

    for (const file of result.files) {
      expect(file.relativePath).not.toContain('\\')
      expect(file.extension).toBe(file.extension.toLowerCase())
      expect(file.contentHash).toMatch(/^[0-9a-f]{64}$/)
      expect(file.sizeBytes).toBeGreaterThanOrEqual(0)
      expect(Number.isInteger(file.modifiedAtMs)).toBe(true)
    }
  })

  it('hashes identical content identically and different content differently', async () => {
    const result = await scanFolder(root, { supportedExtensions: SUPPORTED })
    const retrieval = result.files.find((file) => file.relativePath === 'notes/retrieval.md')
    const storage = result.files.find((file) => file.relativePath === 'notes/storage.md')

    expect(retrieval?.contentHash).not.toBe(storage?.contentHash)

    const directed = await makeTempDir('twigraph-scan-rehash-')
    try {
      await writeFixture(directed, 'a/x.txt', 'same')
      await writeFixture(directed, 'b/x.txt', 'same')
      const again = await scanFolder(directed)
      const hashes = new Set(again.files.map((file) => file.contentHash))
      expect(hashes.size).toBe(1)
    } finally {
      await rm(directed, { recursive: true, force: true })
    }
  })

  it('produces the same result on a second run', async () => {
    const first = await scanFolder(root, { supportedExtensions: SUPPORTED })
    const second = await scanFolder(root, { supportedExtensions: SUPPORTED })

    expect(second.files).toEqual(first.files)
    expect(second.skipped).toEqual(first.skipped)
  })

  it('returns an empty result for an empty folder', async () => {
    const empty = await makeTempDir('twigraph-scan-empty-')
    try {
      const result = await scanFolder(empty)
      expect(result.files).toEqual([])
      expect(result.skipped).toEqual([])
    } finally {
      await rm(empty, { recursive: true, force: true })
    }
  })

  it('reports an unreadable root instead of returning nothing', async () => {
    await expect(scanFolder(join(root, 'does-not-exist'))).rejects.toBeInstanceOf(TwigraphError)
    await expect(scanFolder(join(root, 'does-not-exist'))).rejects.toMatchObject({
      code: 'FOLDER_UNREADABLE',
    })
  })
})
