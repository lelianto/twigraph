import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

interface PackageManifest {
  readonly name?: string
  readonly private?: boolean
  readonly bin?: Record<string, string>
  readonly files?: readonly string[]
  readonly scripts?: Record<string, string>
}

describe('the public npm package', () => {
  it('publishes built CLI and MCP entrypoints instead of TypeScript workspace sources', async () => {
    const manifest = JSON.parse(await readFile('package.json', 'utf8')) as PackageManifest

    expect(manifest.name).toBe('twigraph')
    expect(manifest.private).toBe(false)
    expect(manifest.bin).toEqual({
      twigraph: './dist/cli.js',
      'twigraph-mcp': './dist/mcp.js',
    })
    expect(manifest.files).toEqual(['dist', 'assets/twigraph-logo.png', 'README.md', 'LICENSE'])
    expect(manifest.scripts?.prepack).toBe('npm run build')
  })
})
