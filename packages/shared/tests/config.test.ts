import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { defaultConfig, loadConfig, parseConfig, saveConfig } from '../src/config'
import { MulatError } from '../src/errors'

const temporaryDirectories: string[] = []

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'mulat-config-'))
  temporaryDirectories.push(dir)
  return fn(dir)
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  )
})

describe('defaultConfig', () => {
  it('pins the retrieval and chunking defaults the skill documents', () => {
    const config = defaultConfig()

    expect(config.version).toBe(1)
    expect(config.retrieval.bm25).toEqual({ k1: 1.2, b: 0.75 })
    expect(config.retrieval.rrfK).toBe(60)
    expect(config.retrieval.topK).toBe(8)
    expect(config.chunking).toEqual({ targetTokens: 900, overlapRatio: 0.12 })
  })

  it('starts with no folders, offline off, and the extractive engine', () => {
    const config = defaultConfig()

    expect(config.folders).toEqual([])
    expect(config.offline).toBe(false)
    expect(config.llm.provider).toBe('extractive')
  })

  it('points Ollama at loopback and never at a remote host', () => {
    expect(defaultConfig().llm.ollama.baseUrl).toBe('http://127.0.0.1:11434')
  })

  it('applies overrides without sharing mutable state between calls', () => {
    const first = defaultConfig({ retrieval: { ...defaultConfig().retrieval, topK: 3 } })
    const second = defaultConfig()

    expect(first.retrieval.topK).toBe(3)
    expect(second.retrieval.topK).toBe(8)
  })
})

describe('parseConfig', () => {
  it('accepts a complete, valid document', () => {
    const config = defaultConfig()

    expect(parseConfig(config)).toEqual(config)
  })

  it('rejects a document whose version is not the one this build understands', () => {
    expect(() => parseConfig({ ...defaultConfig(), version: 99 })).toThrowError(/version/i)
  })

  it('rejects a missing version', () => {
    const { version: _version, ...withoutVersion } = defaultConfig()

    expect(() => parseConfig(withoutVersion)).toThrowError(/version/i)
  })

  it('rejects a non-object', () => {
    expect(() => parseConfig('nope')).toThrowError(/object/i)
    expect(() => parseConfig(null)).toThrowError(/object/i)
    expect(() => parseConfig([])).toThrowError(/object/i)
  })

  it('rejects a wrong type with the path of the offending field', () => {
    const config = defaultConfig()

    expect(() => parseConfig({ ...config, offline: 'yes' })).toThrowError(/offline/)
    expect(() =>
      parseConfig({ ...config, retrieval: { ...config.retrieval, topK: -1 } }),
    ).toThrowError(/retrieval\.topK/)
    expect(() =>
      parseConfig({ ...config, retrieval: { ...config.retrieval, bm25: { k1: 1.2 } } }),
    ).toThrowError(/retrieval\.bm25\.b/)
  })

  it('rejects an unknown llm provider instead of silently falling back', () => {
    const config = defaultConfig()

    expect(() =>
      parseConfig({ ...config, llm: { ...config.llm, provider: 'gpt-4' } }),
    ).toThrowError(/llm\.provider/)
  })

  it('rejects an out-of-range overlap ratio', () => {
    const config = defaultConfig()

    expect(() =>
      parseConfig({ ...config, chunking: { ...config.chunking, overlapRatio: 0.9 } }),
    ).toThrowError(/chunking\.overlapRatio/)
  })

  it('ignores unknown keys so a hand-edited file still loads', () => {
    const parsed = parseConfig({ ...defaultConfig(), somethingDeprecated: true })

    expect(parsed).not.toHaveProperty('somethingDeprecated')
    expect(parsed.version).toBe(1)
  })

  it('completes an absent section from the defaults', () => {
    const parsed = parseConfig({ version: 1, offline: true })

    expect(parsed.offline).toBe(true)
    expect(parsed.folders).toEqual([])
    expect(parsed.retrieval).toEqual(defaultConfig().retrieval)
    expect(parsed.llm.provider).toBe('extractive')
  })

  it('treats a half-specified section as a mistake rather than completing it', () => {
    let thrown: unknown
    try {
      parseConfig({ version: 1, retrieval: { topK: 4 } })
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(MulatError)
    expect((thrown as MulatError).code).toBe('CONFIG_INVALID')
    expect((thrown as MulatError).message).toMatch(/retrieval/)
  })

  it('validates folder records', () => {
    const config = defaultConfig()
    const folder = {
      id: 'a1',
      path: 'C:\\Users\\someone\\Documents',
      addedAtMs: 1704067200000,
    }

    expect(parseConfig({ ...config, folders: [folder] }).folders).toHaveLength(1)
    expect(() => parseConfig({ ...config, folders: [{ id: 'a1' }] })).toThrowError(/folders\[0\]/)
  })
})

describe('loadConfig', () => {
  it('returns defaults when the file does not exist yet', async () => {
    await withTempDir(async (dir) => {
      await expect(loadConfig(join(dir, 'config.json'))).resolves.toEqual(defaultConfig())
    })
  })

  it('reads a saved config back unchanged', async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, 'config.json')
      const config = defaultConfig({ offline: true })

      await saveConfig(path, config)

      await expect(loadConfig(path)).resolves.toEqual(config)
    })
  })

  it('writes readable JSON with a trailing newline', async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, 'config.json')

      await saveConfig(path, defaultConfig())

      const raw = await readFile(path, 'utf8')
      expect(raw.endsWith('\n')).toBe(true)
      expect(JSON.parse(raw)).toMatchObject({ version: 1 })
    })
  })

  it('reports malformed JSON as a config error rather than a syntax error', async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, 'config.json')
      await writeFile(path, '{ this is not json', 'utf8')

      await expect(loadConfig(path)).rejects.toThrowError(/config/i)
    })
  })

  it('leaves no temp file behind after saving', async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, 'config.json')
      await saveConfig(path, defaultConfig())

      const { readdir } = await import('node:fs/promises')
      expect(await readdir(dir)).toEqual(['config.json'])
    })
  })
})
