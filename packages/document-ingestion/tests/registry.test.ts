import { describe, expect, it } from 'vitest'

import { TwigraphError } from '@twigraph/shared'

import { createParserRegistry, defaultParsers } from '../src/registry'

describe('parser registry', () => {
  it('exposes the default parsers with sorted ids', () => {
    const registry = createParserRegistry(defaultParsers())
    expect(registry.ids).toEqual(['markdown', 'text'])
  })

  it('reports a version for every registered parser', () => {
    const registry = createParserRegistry(defaultParsers())
    expect(registry.versions).toEqual({ markdown: '1', text: '1' })
  })

  it('resolves an extension to its parser, case-insensitively', () => {
    const registry = createParserRegistry(defaultParsers())
    expect(registry.forExtension('.md')?.id).toBe('markdown')
    expect(registry.forExtension('.MD')?.id).toBe('markdown')
    expect(registry.forExtension('md')?.id).toBe('markdown')
    expect(registry.forExtension('.txt')?.id).toBe('text')
  })

  it('returns null for an extension nobody claims', () => {
    const registry = createParserRegistry(defaultParsers())
    expect(registry.forExtension('.pdf')).toBeNull()
    expect(registry.forExtension('')).toBeNull()
  })

  it('lists every extension it can parse, sorted', () => {
    const registry = createParserRegistry(defaultParsers())
    expect(registry.extensions).toEqual(['.md', '.txt'])
  })

  it('refuses two parsers claiming the same extension', () => {
    const registry = createParserRegistry([])
    const [markdown] = defaultParsers()
    registry.register(markdown!)
    expect(() => registry.register(markdown!)).toThrow(TwigraphError)
  })

  it('starts empty and stays empty', () => {
    const registry = createParserRegistry()
    expect(registry.ids).toEqual([])
    expect(registry.extensions).toEqual([])
    expect(registry.forExtension('.md')).toBeNull()
  })
})

describe('the default parser set', () => {
  it('is a fresh array on every call, so one test cannot poison another', () => {
    expect(defaultParsers()).not.toBe(defaultParsers())
    expect(defaultParsers().map((parser) => parser.id)).toEqual(['markdown', 'text'])
  })

  it('gives every parser a version and at least one extension', () => {
    for (const parser of defaultParsers()) {
      expect(parser.version).toMatch(/^\d+$/)
      expect(parser.extensions.length).toBeGreaterThan(0)
      for (const extension of parser.extensions) {
        expect(extension).toMatch(/^\.[a-z0-9]+$/)
        expect(parser.supports(extension)).toBe(true)
        expect(parser.supports(extension.toUpperCase())).toBe(true)
      }
      expect(parser.supports('.nope')).toBe(false)
    }
  })
})
