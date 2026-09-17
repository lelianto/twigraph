import { rm } from 'node:fs/promises'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { TwigraphError, toWireError } from '@twigraph/shared'

import { createTextParser } from '../src/parsers/text'
import { makeTempDir, parseInputFor, writeFixture } from './helpers'

const parser = createTextParser()

let root = ''

beforeAll(async () => {
  root = await makeTempDir('twigraph-text-')
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

const parse = async (relativePath: string) => parser.parse(await parseInputFor(root, relativePath))

describe('the text parser', () => {
  it('claims .txt and nothing else', () => {
    expect(parser.id).toBe('text')
    expect(parser.extensions).toEqual(['.txt'])
    expect(parser.supports('.txt')).toBe(true)
    expect(parser.supports('.TXT')).toBe(true)
    expect(parser.supports('.md')).toBe(false)
  })

  it('splits paragraphs on blank lines', async () => {
    await writeFixture(root, 'paragraphs.txt', 'First paragraph.\n\nSecond paragraph.\n')
    const document = await parse('paragraphs.txt')

    expect(document.blocks).toEqual([
      { kind: 'paragraph', text: 'First paragraph.' },
      { kind: 'paragraph', text: 'Second paragraph.' },
    ])
  })

  it('keeps a wrapped line inside one paragraph', async () => {
    await writeFixture(root, 'wrapped.txt', 'One paragraph\nover two lines.\n')
    const document = await parse('wrapped.txt')

    expect(document.blocks).toEqual([{ kind: 'paragraph', text: 'One paragraph\nover two lines.' }])
  })

  it('normalises CRLF and strips a byte order mark', async () => {
    await writeFixture(root, 'crlf.txt', '\uFEFFAlpha.\r\n\r\nBeta.\r\n')
    const document = await parse('crlf.txt')

    expect(document.blocks).toEqual([
      { kind: 'paragraph', text: 'Alpha.' },
      { kind: 'paragraph', text: 'Beta.' },
    ])
  })

  it('takes the first line as the title', async () => {
    await writeFixture(root, 'titled.txt', 'Privacy notes\n\nBody.\n')
    const document = await parse('titled.txt')

    expect(document.metadata.title).toBe('Privacy notes')
  })

  it('carries the caller supplied metadata through untouched', async () => {
    await writeFixture(root, 'meta.txt', 'Body.\n')
    const input = await parseInputFor(root, 'meta.txt')
    const document = await parser.parse(input)

    expect(document.metadata).toMatchObject({
      filename: 'meta.txt',
      relativePath: 'meta.txt',
      absolutePath: input.absolutePath,
      extension: '.txt',
      sizeBytes: input.sizeBytes,
      modifiedAtMs: input.modifiedAtMs,
      contentHash: input.contentHash,
      parseWarnings: [],
    })
  })

  it('reports an empty file rather than returning an empty document', async () => {
    await writeFixture(root, 'empty.txt', '')
    await expect(parse('empty.txt')).rejects.toThrow(TwigraphError)
    await expect(parse('empty.txt')).rejects.toMatchObject({ code: 'PARSE_EMPTY' })
  })

  it('reports a file that is only whitespace', async () => {
    await writeFixture(root, 'blank.txt', '   \n\n\t\n   ')
    await expect(parse('blank.txt')).rejects.toMatchObject({ code: 'PARSE_EMPTY' })
  })

  it('reports undecodable bytes instead of producing replacement characters', async () => {
    await writeFixture(root, 'bad.txt', Buffer.from([0x68, 0x69, 0x20, 0xc3, 0x28]))
    await expect(parse('bad.txt')).rejects.toMatchObject({ code: 'PARSE_FAILED' })
  })

  it('reports a missing file, and never lets a path ride out in the wire error', async () => {
    const input = await parseInputFor(root, 'titled.txt')
    const missing = { ...input, absolutePath: `${input.absolutePath}.gone` }

    await expect(parser.parse(missing)).rejects.toMatchObject({ code: 'PARSE_FAILED' })
    try {
      await parser.parse(missing)
    } catch (error) {
      expect(JSON.stringify(toWireError(error))).not.toContain('titled.txt')
    }
  })
})
