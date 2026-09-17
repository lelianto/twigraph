import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const resolve = (path: string): string => fileURLToPath(new URL(path, import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
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
