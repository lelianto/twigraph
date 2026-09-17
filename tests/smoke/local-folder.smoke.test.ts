/**
 * Local smoke harness: drives every piece of @twigraph/shared that exists today against a
 * real folder on this machine, with the whole flow inside the `offline` network guard.
 *
 * It reads directory entries and file metadata only. No document content is read, printed
 * or stored anywhere.
 *
 * The parts that touch a real folder depend on this machine, so they are opt-in and stay
 * out of the default suite:
 *
 *   $env:TWIGRAPH_SMOKE_REAL='1'; npx vitest run tests/smoke --no-coverage
 *
 * The network-guard tests below need no opt-in: they are deterministic and prove the
 * promise on their own.
 */

import dns from 'node:dns'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { extname, join } from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

import type { Answer, ChunkRecord, Citation, FolderRecord } from '../../packages/shared/src/index'
import {
  assertGrounded,
  canonicalFolderPath,
  defaultConfig,
  describeLocation,
  folderIdFor,
  formatCitationLabel,
  IPC_CHANNELS,
  IPC_EVENTS,
  isVerbatimExcerpt,
  loadConfig,
  TwigraphError,
  parseConfig,
  PRIVACY_MESSAGE,
  saveConfig,
  toWireError,
} from '../../packages/shared/src/index'
import { installNetworkGuard } from '../setup/no-network'

const HOME = homedir()
const PROJECT_DIR = process.cwd()
const SCAN_LIMIT = 50_000

const REAL_FOLDER_TESTS = process.env.TWIGRAPH_SMOKE_REAL === '1'
const describeReal = describe.skipIf(!REAL_FOLDER_TESTS)

const REAL_FOLDERS: readonly { label: string; path: string }[] = [
  { label: 'twigraph project', path: PROJECT_DIR },
  { label: 'Documents', path: join(HOME, 'Documents') },
  { label: 'Desktop', path: join(HOME, 'Desktop') },
]

interface FolderScan {
  readonly files: number
  readonly directories: number
  readonly bytes: number
  readonly byExtension: ReadonlyArray<readonly [string, number]>
  readonly truncated: boolean
}

/** Directory entries and sizes only: never opens a file. */
async function scanFolder(root: string): Promise<FolderScan> {
  let files = 0
  let directories = 0
  let bytes = 0
  let seen = 0
  let truncated = false
  const counts = new Map<string, number>()
  const stack: string[] = [root]

  while (stack.length > 0 && !truncated) {
    const current = stack.pop()
    if (current === undefined) break

    let entries
    try {
      entries = await readdir(current, { withFileTypes: true })
    } catch {
      continue
    }

    for (const entry of entries) {
      if (seen >= SCAN_LIMIT) {
        truncated = true
        break
      }
      seen += 1

      const full = join(current, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        directories += 1
        stack.push(full)
        continue
      }
      if (!entry.isFile()) continue

      files += 1
      const extension = extname(entry.name).toLowerCase()
      const key = extension === '' ? '(no ext)' : extension
      counts.set(key, (counts.get(key) ?? 0) + 1)

      try {
        bytes += (await stat(full)).size
      } catch {
        // A file we cannot stat still counts as seen; it just contributes no bytes.
      }
    }
  }

  const byExtension = [...counts.entries()].sort((a, b) => b[1] - a[1])
  return { files, directories, bytes, byExtension, truncated }
}

const dataDir = await mkdtemp(join(tmpdir(), 'twigraph-smoke-'))
const configPath = join(dataDir, 'config.json')

const scans = new Map<string, FolderScan>()

afterAll(async () => {
  await rm(dataDir, { recursive: true, force: true })
})

describeReal('real folders on this laptop', () => {
  it('finds the folders the user asked about', () => {
    for (const folder of REAL_FOLDERS) {
      console.log(`  ${folder.label.padEnd(14)} ${folder.path}  exists=${existsSync(folder.path)}`)
    }
    expect(existsSync(PROJECT_DIR)).toBe(true)
  })

  it('enumerates their contents without opening a single file', async () => {
    for (const folder of REAL_FOLDERS) {
      if (!existsSync(folder.path)) continue
      const scan = await scanFolder(folder.path)
      scans.set(folder.label, scan)
      const top = scan.byExtension
        .slice(0, 8)
        .map(([ext, count]) => `${ext}:${count}`)
        .join('  ')
      console.log(
        `  ${folder.label.padEnd(14)} files=${String(scan.files).padStart(6)}` +
          ` dirs=${String(scan.directories).padStart(5)}` +
          ` bytes=${String(scan.bytes).padStart(12)}` +
          `${scan.truncated ? ' (truncated)' : ''}\n` +
          `                 ${top}`,
      )
    }
    expect(scans.size).toBeGreaterThan(0)
  })
})

describe('folder identity on a real path', () => {
  it('canonicalises the path the same way every time', () => {
    const raw = PROJECT_DIR
    const canonical = canonicalFolderPath(raw)
    expect(canonicalFolderPath(`${raw}\\`)).toBe(canonical)
    expect(canonicalFolderPath(`${raw}/`)).toBe(canonical)
    console.log(`  canonical: ${canonical}`)
  })

  it('derives a stable id, and folds Windows case', () => {
    const canonical = canonicalFolderPath(PROJECT_DIR)
    const first = folderIdFor(canonical)
    expect(folderIdFor(canonical)).toBe(first)
    expect(folderIdFor(canonical.toUpperCase(), 'win32')).toBe(first)
    expect(folderIdFor(`${canonical}\\`)).toBe(first)
    console.log(`  folderId : ${first}`)
  })

  it('gives a different id on a case-sensitive platform', () => {
    const canonical = canonicalFolderPath(PROJECT_DIR)
    expect(folderIdFor(canonical.toUpperCase(), 'linux')).not.toBe(folderIdFor(canonical, 'linux'))
  })
})

describe('config against a real data directory', () => {
  const record: FolderRecord = {
    id: folderIdFor(canonicalFolderPath(PROJECT_DIR)),
    path: canonicalFolderPath(PROJECT_DIR),
    addedAtMs: 1_700_000_000_000,
  }

  it('starts from defaults with no storage section', () => {
    const config = defaultConfig()
    expect('storage' in config).toBe(false)
    expect(config.retrieval.bm25).toEqual({ k1: 1.2, b: 0.75 })
    expect(config.offline).toBe(false)
  })

  it('treats a missing config file as first run', async () => {
    const missing = join(dataDir, 'does-not-exist.json')
    expect(await loadConfig(missing)).toEqual(defaultConfig())
  })

  it('saves atomically, leaving no .tmp behind', async () => {
    await saveConfig(configPath, defaultConfig({ folders: [record], offline: true }))
    expect(existsSync(`${configPath}.tmp`)).toBe(false)
    expect(existsSync(configPath)).toBe(true)
  })

  it('round-trips the real folder through save and load', async () => {
    const loaded = await loadConfig(configPath)
    expect(loaded.folders).toEqual([record])
    expect(loaded.offline).toBe(true)
    expect(loaded.folders[0]?.path).toBe(canonicalFolderPath(PROJECT_DIR))
  })

  it('rewrites byte-identical output for identical input', async () => {
    const before = await readFile(configPath, 'utf8')
    await saveConfig(configPath, await loadConfig(configPath))
    expect(await readFile(configPath, 'utf8')).toBe(before)
  })

  it('refuses a future config version', () => {
    expect(() => parseConfig({ version: 2 })).toThrow(TwigraphError)
    try {
      parseConfig({ version: 2 })
    } catch (error) {
      expect(toWireError(error).code).toBe('CONFIG_VERSION_UNSUPPORTED')
    }
  })

  it('refuses half a section instead of completing it', () => {
    expect(() => parseConfig({ version: 1, retrieval: { topK: 5 } })).toThrow(TwigraphError)
  })

  it('never lets a disk path ride along with an unexpected error', () => {
    const leaky = new Error('ENOENT: no such file or directory, open C:\\Users\\me\\private.txt')
    const wire = toWireError(leaky)
    expect(wire.code).toBe('INTERNAL')
    expect(JSON.stringify(wire)).not.toContain('private.txt')
    console.log(`  wire     : ${JSON.stringify(wire)}`)
  })
})

describe('citations and the grounding invariant', () => {
  const row: ChunkRecord = {
    id: 'chunk-1',
    documentId: 'doc-1',
    ordinal: 0,
    text: 'The indexer writes to a staging directory and swaps it in, so a live index is never mutated.',
    page: 4,
    pageEnd: 6,
    headingPath: ['Storage', 'Atomic writes'],
    charStart: 0,
    charEnd: 103,
  }

  const citation: Citation = {
    marker: 1,
    chunkId: row.id,
    filename: 'ARCHITECTURE.md',
    absolutePath: join(PROJECT_DIR, 'docs', 'ARCHITECTURE.md'),
    page: row.page,
    pageEnd: row.pageEnd,
    headingPath: row.headingPath,
    excerpt: 'writes to a staging directory and swaps it in',
  }

  const answerWith = (passageText: string, citations: readonly Citation[]): Answer => ({
    status: 'answered',
    text: `${passageText} [1]`,
    passages: [{ text: passageText, citationMarkers: [1] }],
    citations,
    provider: 'extractive',
    unverifiedMarkers: [],
    sources: [],
  })

  it('labels a location from real chunk metadata', () => {
    expect(describeLocation(citation)).toBe(
      'pp. 4\u20136 \u00b7 \u00a7 Storage \u203a Atomic writes',
    )
    expect(formatCitationLabel(citation)).toBe(
      'ARCHITECTURE.md \u2014 pp. 4\u20136 \u00b7 \u00a7 Storage \u203a Atomic writes',
    )
    console.log(`  label    : ${formatCitationLabel(citation)}`)
  })

  it('accepts a verbatim excerpt', () => {
    expect(isVerbatimExcerpt(citation.excerpt, row.text)).toBe(true)
  })

  it('rejects a paraphrase', () => {
    expect(isVerbatimExcerpt('swaps the directory after writing', row.text)).toBe(false)
  })

  it('lets a grounded answer through', () => {
    const answer = answerWith('writes to a staging directory and swaps it in', [citation])
    expect(() => assertGrounded(answer, new Map([[row.id, row.text]]))).not.toThrow()
  })

  it('blocks an answer that the sources do not support', () => {
    const answer = answerWith('The indexer copies the whole index before every write.', [citation])
    expect(() => assertGrounded(answer, new Map([[row.id, row.text]]))).toThrow(TwigraphError)
  })

  it('blocks a citation pointing at a chunk that was never retrieved', () => {
    const answer = answerWith('writes to a staging directory and swaps it in', [citation])
    expect(() => assertGrounded(answer, new Map())).toThrow(TwigraphError)
  })

  it('blocks a marker that has no citation at all', () => {
    const answer = answerWith('writes to a staging directory and swaps it in', [])
    expect(() => assertGrounded(answer, new Map([[row.id, row.text]]))).toThrow(TwigraphError)
  })

  it('leaves an insufficient answer alone', () => {
    const insufficient: Answer = {
      ...answerWith('irrelevant', []),
      status: 'insufficient',
      text: 'No reliable answer found.',
    }
    expect(() => assertGrounded(insufficient, new Map())).not.toThrow()
  })
})

describe('the IPC surface', () => {
  it('exposes only named channels, with no generic passthrough', () => {
    const channels = Object.values(IPC_CHANNELS)
    expect(new Set(channels).size).toBe(channels.length)
    expect(channels).toHaveLength(16)
    expect(channels.every((channel) => channel.includes(':'))).toBe(true)
    console.log(`  channels : ${channels.join(', ')}`)
    console.log(`  events   : ${Object.values(IPC_EVENTS).join(', ')}`)
  })

  it('carries the privacy promise', () => {
    expect(PRIVACY_MESSAGE).toBe('Your files stay on this device.')
  })
})

describe('the whole flow, inside the offline guard', () => {
  it.skipIf(!REAL_FOLDER_TESTS)(
    'touches no network while reading a real folder and writing a real config',
    async () => {
      const guard = installNetworkGuard({ mode: 'offline' })
      try {
        const scan = await scanFolder(PROJECT_DIR)
        expect(scan.files).toBeGreaterThan(0)

        const canonical = canonicalFolderPath(PROJECT_DIR)
        const record: FolderRecord = {
          id: folderIdFor(canonical),
          path: canonical,
          addedAtMs: 1_700_000_000_000,
          lastIndexedAtMs: 1_700_000_100_000,
          documentCount: scan.files,
          chunkCount: 0,
        }
        const saved = defaultConfig({ folders: [record], offline: true })
        await saveConfig(configPath, saved)
        const loaded = await loadConfig(configPath)
        expect(loaded.folders[0]?.documentCount).toBe(scan.files)

        expect(guard.blocked()).toEqual([])
        expect(guard.attempts()).toEqual([])
      } finally {
        guard.restore()
      }
    },
  )

  it('proves the guard is live rather than vacuous', async () => {
    const guard = installNetworkGuard({ mode: 'offline' })
    try {
      await expect(fetch('https://example.com/')).rejects.toThrow(/forbidden/i)
      await expect(fetch('http://127.0.0.1:11434/api/tags')).rejects.toThrow(/forbidden/i)
      await expect(dns.promises.lookup('example.com')).rejects.toThrow(/forbidden/i)
      expect(guard.blocked().map((attempt) => attempt.target)).toEqual([
        'example.com:443',
        '127.0.0.1:11434',
        'example.com',
      ])
      console.log(
        `  blocked  : ${guard
          .blocked()
          .map((a) => `${a.kind} ${a.target}`)
          .join(', ')}`,
      )
    } finally {
      guard.restore()
    }
  })

  it('lets loopback through in the default mode, and nothing else', async () => {
    const guard = installNetworkGuard({ mode: 'default' })
    try {
      await expect(fetch('https://example.com/')).rejects.toThrow(/forbidden/i)
      expect(guard.blocked()).toHaveLength(1)
      expect(guard.attempts()).toHaveLength(1)
    } finally {
      guard.restore()
    }
  })
})
