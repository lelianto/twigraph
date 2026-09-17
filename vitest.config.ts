import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const resolve = (path: string): string => fileURLToPath(new URL(path, import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      // Before '@twigraph/shared': a Vite alias matches on a path prefix, so the bare entry
      // would otherwise swallow these subpaths and resolve them to '.…/src/index.ts/ipc'.
      // They exist so a renderer can reach a value without pulling in the whole package,
      // which reaches for node:fs.
      '@twigraph/shared/citations': resolve('./packages/shared/src/citations.ts'),
      '@twigraph/shared/ipc': resolve('./packages/shared/src/ipc.ts'),
      '@twigraph/shared': resolve('./packages/shared/src/index.ts'),
      '@twigraph/document-ingestion': resolve('./packages/document-ingestion/src/index.ts'),
      '@twigraph/indexing': resolve('./packages/indexing/src/index.ts'),
      '@twigraph/retrieval': resolve('./packages/retrieval/src/index.ts'),
      '@twigraph/providers': resolve('./packages/providers/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['packages/*/tests/**/*.test.ts', 'apps/*/tests/**/*.test.ts', 'tests/**/*.test.ts'],
    testTimeout: 30_000,
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'lcov'],
      include: ['packages/*/src/**/*.ts', 'tests/setup/**/*.ts'],
      exclude: ['**/*.test.ts', '**/index.ts', '**/*.d.ts'],
      thresholds: {
        lines: 90,
        statements: 90,
        functions: 90,
        branches: 85,
      },
    },
  },
})
