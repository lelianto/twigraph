import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { createWindowOptions } from '../src/main/window-options'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const SRC = join(HERE, '..', 'src')
const RENDERER = join(SRC, 'renderer')
const PRELOAD = join(SRC, 'preload')

async function sourcesIn(directory: string): Promise<readonly string[]> {
  const names = (await readdir(directory, { recursive: true })) as readonly string[]
  return names
    .filter((name) => name.endsWith('.ts') || name.endsWith('.tsx'))
    .map((name) => join(directory, name))
}

describe('the window the app opens', () => {
  it('isolates the page, keeps Node out of it, and sandboxes it', () => {
    const options = createWindowOptions({
      preloadPath: 'C:\\app\\preload.cjs',
      iconPath: 'C:\\app\\logo.png',
    })

    expect(options.webPreferences).toMatchObject({
      preload: 'C:\\app\\preload.cjs',
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    })
    expect(options.webPreferences?.nodeIntegrationInWorker).toBeUndefined()
  })
})

describe('the policy the page carries', () => {
  it('refuses everything it does not name, including the network', async () => {
    const html = await readFile(join(RENDERER, 'index.html'), 'utf8')

    expect(html).toContain("default-src 'none'")
    expect(html).toContain("connect-src 'none'")
    expect(html).toContain("script-src 'self'")
    expect(html).toContain("img-src 'self' data:")
    expect(html).toContain("object-src 'none'")
  })

  it('loads its own files and nothing from anywhere else', async () => {
    const html = await readFile(join(RENDERER, 'index.html'), 'utf8')

    expect(html).not.toMatch(/https?:\/\//)
    // An inline script would need 'unsafe-inline', which this policy does not grant.
    expect(html).not.toContain('<script>')
  })
})

describe('the boundary between the page and Node', () => {
  it('never lets the renderer reach a Node built-in or Electron itself', async () => {
    const files = await sourcesIn(RENDERER)
    expect(files.length).toBeGreaterThan(4)

    for (const file of files) {
      const source = await readFile(file, 'utf8')
      expect(source, file).not.toMatch(/from ['"]node:/)
      expect(source, file).not.toMatch(/from ['"]electron['"]/)
      expect(source, file).not.toMatch(/require\(/)
    }
  })

  it('lets the preload reach Electron, but no further into the machine than that', async () => {
    const files = await sourcesIn(PRELOAD)
    expect(files.length).toBeGreaterThan(1)

    for (const file of files) {
      const source = await readFile(file, 'utf8')
      // The sandboxed preload has no filesystem, and must not bundle one in by accident.
      expect(source, file).not.toMatch(/from ['"]node:/)
    }
  })

  it('exposes the api through contextBridge and nothing else', async () => {
    const source = await readFile(join(PRELOAD, 'preload.ts'), 'utf8')

    expect(source).toContain("contextBridge.exposeInMainWorld('twigraph'")
    expect(source.match(/exposeInMainWorld/g)).toHaveLength(1)
  })
})
