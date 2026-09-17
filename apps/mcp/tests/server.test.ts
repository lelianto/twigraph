import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { describe, expect, it } from 'vitest'

import type { McpSearchService } from '../src/service'
import { createTwigraphMcpServer } from '../src/server'

const service: McpSearchService = {
  search: async ({ query }) => ({
    query,
    mode: 'lexical',
    tookMs: 0,
    confident: true,
    hits: [],
  }),
  status: async () => ({ folders: [] }),
  getChunk: async () => null,
}

describe('twigraph MCP server', () => {
  it('advertises read-only local search tools and serves structured output', async () => {
    const server = createTwigraphMcpServer(service)
    const client = new Client({ name: 'test-client', version: '1.0.0' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()

    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
    try {
      const tools = await client.listTools()
      expect(tools.tools.map((tool) => tool.name)).toEqual([
        'twigraph_search',
        'twigraph_status',
        'twigraph_get_chunk',
      ])
      expect(tools.tools.every((tool) => tool.annotations?.readOnlyHint === true)).toBe(true)

      const result = await client.callTool({
        name: 'twigraph_search',
        arguments: { query: 'termination' },
      })
      expect(result.isError).not.toBe(true)
      expect(result.structuredContent).toEqual(
        expect.objectContaining({ query: 'termination', confident: true }),
      )
    } finally {
      await client.close()
      await server.close()
    }
  })
})
