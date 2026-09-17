import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { generateFixtures } from '../../../fixtures/generate.mjs'
import { installNetworkGuard } from '../../../tests/setup/no-network'
import { buildIndex, createIndexStore } from '@twigraph/indexing'
import { createFolderRegistry, loadConfig } from '@twigraph/shared'

import { createMcpSearchService } from '../src/service'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('MCP local-only flow', () => {
  it('indexes and searches synthetic documents without any network attempt', async () => {
    const source = await mkdtemp(join(tmpdir(), 'twigraph-mcp-source-'))
    const dataDir = await mkdtemp(join(tmpdir(), 'twigraph-mcp-data-'))
    roots.push(source, dataDir)
    await generateFixtures(source)

    const guard = installNetworkGuard({ mode: 'offline' })
    try {
      const configPath = join(dataDir, 'config.json')
      const registry = createFolderRegistry(configPath)
      const folder = await registry.add(source, 1)
      const data = createIndexStore({ dataDir })
      await buildIndex(data, {
        folderId: folder.id,
        folderPath: source,
        nowMs: 2,
        chunking: (await loadConfig(configPath)).chunking,
      })

      const service = createMcpSearchService({
        registry,
        store: data.store,
        retrieval: (await loadConfig(configPath)).retrieval,
        now: () => 3,
      })
      const result = await service.search({ query: 'reciprocal rank fusion', topK: 2 })

      expect(result.confident).toBe(true)
      expect(result.hits[0]?.filename).toBe('retrieval.md')
      expect(result.hits[0]?.text).toContain('reciprocal rank fusion')
      expect(guard.attempts()).toEqual([])
      expect(guard.blocked()).toEqual([])
    } finally {
      guard.restore()
    }
  })
})
