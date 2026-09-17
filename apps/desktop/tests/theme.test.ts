import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const desktop = fileURLToPath(new URL('../src/renderer/', import.meta.url))
const app = readFileSync(`${desktop}/App.tsx`, 'utf8')
const status = readFileSync(`${desktop}/components/StatusBar.tsx`, 'utf8')
const styles = readFileSync(`${desktop}/app.css`, 'utf8')

describe('the desktop theme contract', () => {
  it('uses the system theme until a person explicitly chooses another', () => {
    expect(styles).toContain('color-scheme: light dark')
    expect(styles).toMatch(/@media \(prefers-color-scheme: dark\)/)
    expect(app).toContain("type ThemePreference = 'system' | 'light' | 'dark'")
    expect(app).toContain("localStorage.getItem('twigraph-theme')")
  })

  it('offers system, light and dark choices in settings', () => {
    expect(status).toContain('Theme')
    expect(status).toContain('value="system"')
    expect(status).toContain('value="light"')
    expect(status).toContain('value="dark"')
  })
})
