import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { toWireError } from '@twigraph/shared'

import type { McpSearchService } from './service'

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const

function result(value: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(value) }],
    structuredContent: value as Record<string, unknown>,
  }
}

function errorResult(error: unknown) {
  const wire = toWireError(error)
  return {
    isError: true,
    content: [{ type: 'text' as const, text: wire.message }],
  }
}

export function createTwigraphMcpServer(service: McpSearchService): McpServer {
  const server = new McpServer({ name: 'twigraph', version: '0.1.0' })

  server.registerTool(
    'twigraph_search',
    {
      title: 'Search indexed local documents',
      description:
        'Search twigraph local indexes and return source-grounded text chunks with file paths and citation metadata. Use this before broad filesystem scans when looking for file contents.',
      inputSchema: {
        query: z.string().trim().min(1),
        topK: z.number().int().min(1).max(20).optional(),
        folderIds: z.array(z.string().min(1)).max(50).optional(),
      },
      annotations: READ_ONLY,
    },
    async (input) => {
      try {
        return result(await service.search(input))
      } catch (error) {
        return errorResult(error)
      }
    },
  )

  server.registerTool(
    'twigraph_status',
    {
      title: 'Inspect twigraph indexes',
      description: 'List registered local folders and report whether each has a readable index.',
      annotations: READ_ONLY,
    },
    async () => {
      try {
        return result(await service.status())
      } catch (error) {
        return errorResult(error)
      }
    },
  )

  server.registerTool(
    'twigraph_get_chunk',
    {
      title: 'Read an indexed chunk',
      description:
        'Return one exact indexed text chunk and its source metadata. This reads the index, not the original source file.',
      inputSchema: { chunkId: z.string().trim().min(1) },
      annotations: READ_ONLY,
    },
    async (input) => {
      try {
        return result(await service.getChunk(input))
      } catch (error) {
        return errorResult(error)
      }
    },
  )

  return server
}
