import { rm } from 'node:fs/promises'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { MulatError } from '@mulat/shared'

import { createMarkdownParser } from '../src/parsers/markdown'
import { makeTempDir, parseInputFor, writeFixture } from './helpers'

const parser = createMarkdownParser()
const FENCE = '```'

let root = ''

beforeAll(async () => {
  root = await makeTempDir('mulat-markdown-')
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

const parse = async (relativePath: string) => parser.parse(await parseInputFor(root, relativePath))

const lines = (...parts: readonly string[]): string => `${parts.join('\n')}\n`

describe('the markdown parser', () => {
  it('claims .md and nothing else', () => {
    expect(parser.id).toBe('markdown')
    expect(parser.extensions).toEqual(['.md'])
    expect(parser.supports('.md')).toBe(true)
    expect(parser.supports('.MARKDOWN')).toBe(false)
  })

  it('turns the whole document into blocks', async () => {
    await writeFixture(
      root,
      'golden.md',
      lines(
        '# Title',
        '',
        'Intro paragraph.',
        '',
        '## Section',
        '',
        '- one',
        '- two',
        '',
        `${FENCE}ts`,
        'const a = 1',
        FENCE,
        '',
        '| a | b |',
        '| - | - |',
        '| 1 | 2 |',
      ),
    )

    const document = await parse('golden.md')

    expect(document.blocks).toEqual([
      { kind: 'heading', level: 1, text: 'Title' },
      { kind: 'paragraph', text: 'Intro paragraph.' },
      { kind: 'heading', level: 2, text: 'Section' },
      { kind: 'list', text: 'one\ntwo' },
      { kind: 'code', text: 'const a = 1' },
      { kind: 'table', text: '| a | b |\n| - | - |\n| 1 | 2 |' },
    ])
  })

  it('records heading levels one through six', async () => {
    await writeFixture(
      root,
      'levels.md',
      lines(
        '# One',
        '',
        '## Two',
        '',
        '### Three',
        '',
        '#### Four',
        '',
        '##### Five',
        '',
        '###### Six',
      ),
    )

    const document = await parse('levels.md')
    expect(document.blocks.map((block) => block.level)).toEqual([1, 2, 3, 4, 5, 6])
    expect(document.blocks.every((block) => block.kind === 'heading')).toBe(true)
  })

  it('does not treat seven hashes, or a hash with no space, as a heading', async () => {
    await writeFixture(root, 'not-headings.md', lines('####### Seven', '', '#NoSpace'))
    const document = await parse('not-headings.md')

    expect(document.blocks).toEqual([
      { kind: 'paragraph', text: '####### Seven' },
      { kind: 'paragraph', text: '#NoSpace' },
    ])
  })

  it('strips a closing hash run from a heading', async () => {
    await writeFixture(root, 'closing.md', lines('## Trailing ##'))
    const document = await parse('closing.md')

    expect(document.blocks).toEqual([{ kind: 'heading', level: 2, text: 'Trailing' }])
  })

  it('keeps the code and drops the fence and the language tag', async () => {
    await writeFixture(root, 'code.md', lines(`${FENCE}python`, '# not a heading', 'x = 1', FENCE))
    const document = await parse('code.md')

    expect(document.blocks).toEqual([{ kind: 'code', text: '# not a heading\nx = 1' }])
  })

  it('treats an unterminated fence as code running to the end', async () => {
    await writeFixture(root, 'open-fence.md', lines(FENCE, 'still code', '# still code too'))
    const document = await parse('open-fence.md')

    expect(document.blocks).toEqual([{ kind: 'code', text: 'still code\n# still code too' }])
  })

  it('accepts every unordered marker and an ordered list', async () => {
    await writeFixture(
      root,
      'lists.md',
      lines('- dash', '* star', '+ plus', '1. first', '2) second'),
    )

    const document = await parse('lists.md')
    expect(document.blocks).toEqual([{ kind: 'list', text: 'dash\nstar\nplus\nfirst\nsecond' }])
  })

  it('keeps a nested item as its own line', async () => {
    await writeFixture(root, 'nested.md', lines('- first item', '  - nested item', '- second item'))
    const document = await parse('nested.md')

    expect(document.blocks).toEqual([
      { kind: 'list', text: 'first item\nnested item\nsecond item' },
    ])
  })

  it('joins wrapped paragraph lines', async () => {
    await writeFixture(root, 'wrapped.md', lines('One sentence that', 'continues here.'))
    const document = await parse('wrapped.md')

    expect(document.blocks).toEqual([
      { kind: 'paragraph', text: 'One sentence that\ncontinues here.' },
    ])
  })

  it('normalises CRLF', async () => {
    await writeFixture(root, 'crlf.md', '# Title\r\n\r\nBody.\r\n')
    const document = await parse('crlf.md')

    expect(document.blocks).toEqual([
      { kind: 'heading', level: 1, text: 'Title' },
      { kind: 'paragraph', text: 'Body.' },
    ])
  })

  it('uses the first heading as the title, falling back to the first line', async () => {
    await writeFixture(root, 'titled.md', lines('# Real title', '', 'Body.'))
    await writeFixture(root, 'untitled.md', lines('Just a paragraph.'))

    expect((await parse('titled.md')).metadata.title).toBe('Real title')
    expect((await parse('untitled.md')).metadata.title).toBe('Just a paragraph.')
  })

  it('reports an empty document', async () => {
    await writeFixture(root, 'empty.md', '')
    await expect(parse('empty.md')).rejects.toMatchObject({ code: 'PARSE_EMPTY' })
  })

  it('reports a document that is only blank lines', async () => {
    await writeFixture(root, 'blank.md', '\n\n   \n\n')
    await expect(parse('blank.md')).rejects.toMatchObject({ code: 'PARSE_EMPTY' })
  })

  it('reports undecodable bytes', async () => {
    await writeFixture(root, 'bad.md', Buffer.from([0xc3, 0x28, 0x62]))
    await expect(parse('bad.md')).rejects.toMatchObject({ code: 'PARSE_FAILED' })
  })

  it('never throws something that is not a MulatError', async () => {
    await writeFixture(root, 'missing-target.md', 'Body.\n')
    const input = await parseInputFor(root, 'missing-target.md')

    await expect(
      parser.parse({ ...input, absolutePath: `${input.absolutePath}.gone` }),
    ).rejects.toBeInstanceOf(MulatError)
  })
})
