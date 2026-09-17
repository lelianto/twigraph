import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { join } from 'node:path'

import { createIndexStore } from '@twigraph/indexing'
import { createFolderRegistry, loadConfig, toWireError } from '@twigraph/shared'

import { resolveDataDir } from '../../cli/src/paths'
import { createTwigraphMcpServer } from './server'
import { createMcpSearchService } from './service'

async function main(): Promise<void> {
  const dataDir = resolveDataDir(undefined, process.env)
  const configPath = join(dataDir, 'config.json')
  const config = await loadConfig(configPath)
  const service = createMcpSearchService({
    registry: createFolderRegistry(configPath),
    store: createIndexStore({ dataDir }).store,
    retrieval: config.retrieval,
  })

  await createTwigraphMcpServer(service).connect(new StdioServerTransport())
}

main().catch((error: unknown) => {
  process.stderr.write(`twigraph MCP failed: ${toWireError(error).message}\n`)
  process.exitCode = 1
})
