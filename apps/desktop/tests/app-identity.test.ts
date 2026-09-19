import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { APP_ID } from '../src/main/app-identity'

const REPO = fileURLToPath(new URL('../../../', import.meta.url))

describe('the desktop app identity', () => {
  it('names the same app the installer writes into its shortcuts', () => {
    const config = readFileSync(join(REPO, 'apps', 'desktop', 'electron-builder.yml'), 'utf8')
    const appId = /^appId:[ \t]*(\S+)[ \t]*$/m.exec(config)?.[1]

    // A mismatch is silent in every other test: the window opens, the installer installs, and
    // only a pinned taskbar shortcut shows that the two disagree.
    expect(appId).toBe(APP_ID)
  })

  it('is the id a window can be grouped under', () => {
    expect(APP_ID).toMatch(/^[a-z0-9]+(\.[a-z0-9-]+)+$/)
  })
})
