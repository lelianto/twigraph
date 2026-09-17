import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { generateFixtures } from '../../../fixtures/generate.mjs'
import { installNetworkGuard } from '../../../tests/setup/no-network'
import { run } from '../src/cli'
import { defaultDataDir, resolveDataDir } from '../src/paths'

const NOW = 1_700_000_000_000

let root = ''
let dataDir = ''

interface Capture {
  readonly code: number
  readonly lines: readonly string[]
  readonly errors: readonly string[]
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'twigraph-cli-src-'))
  dataDir = await mkdtemp(join(tmpdir(), 'twigraph-cli-data-'))
  await generateFixtures(root)
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
  await rm(dataDir, { recursive: true, force: true })
})

async function cli(
  argv: readonly string[],
  overrides: { readonly dataDir?: string } = {},
): Promise<Capture> {
  const lines: string[] = []
  const errors: string[] = []
  const code = await run([...argv, '--data-dir', overrides.dataDir ?? dataDir], {
    out: (line) => lines.push(line),
    err: (line) => errors.push(line),
    now: () => NOW,
    env: {},
    cwd: root,
  })
  return { code, lines, errors }
}

/** Adds the fixture folder and returns its id, as a user would get it from the CLI. */
async function addFolder(): Promise<string> {
  const result = await cli(['folder', 'add', root])
  expect(result.code).toBe(0)
  const id = await cli(['folder', 'list', '--json'])
  const listed = JSON.parse(id.lines.join('\n')) as { folders: { id: string }[] }
  const first = listed.folders[0]
  if (first === undefined) throw new Error('the folder was not listed')
  return first.id
}

describe('help and usage', () => {
  it('prints the usage and succeeds', async () => {
    const result = await cli(['help'])
    expect(result.code).toBe(0)
    expect(result.lines.join('\n')).toContain('twigraph folder add <path>')
  })

  it('prints the usage when given nothing at all', async () => {
    expect((await cli([])).lines.join('\n')).toContain('Usage:')
  })

  it('rejects an unknown command with the usage exit code', async () => {
    const result = await cli(['frobnicate'])
    expect(result.code).toBe(2)
    expect(result.errors.join('\n')).toContain('Unknown command')
  })

  it('rejects a search with no query', async () => {
    const result = await cli(['search'])
    expect(result.code).toBe(2)
    expect(result.errors.join('\n')).toContain('usage: twigraph search')
  })

  it('rejects a --top that is not a count', async () => {
    expect((await cli(['search', 'anything', '--top', 'lots'])).code).toBe(2)
  })
})

describe('managing folders', () => {
  it('starts with nothing', async () => {
    expect((await cli(['folder', 'list'])).lines.join('\n')).toContain('No folders yet')
  })

  it('adds a folder and lists it', async () => {
    const added = await cli(['folder', 'add', root])
    expect(added.code).toBe(0)
    expect(added.lines.join('\n')).toContain(root)

    const listed = await cli(['folder', 'list'])
    expect(listed.lines.join('\n')).toContain(root)
  })

  it('creates its data directory on first use, without being asked to', async () => {
    const fresh = join(dataDir, 'not', 'created', 'yet')
    const result = await cli(['folder', 'add', root], { dataDir: fresh })

    expect(result.code).toBe(0)
    expect(existsSync(join(fresh, 'config.json'))).toBe(true)
  })

  it('refuses the same folder twice', async () => {
    await cli(['folder', 'add', root])
    const again = await cli(['folder', 'add', root])

    expect(again.code).toBe(1)
    expect(again.errors.join('\n')).toContain('already in the list')
  })

  it('refuses a folder that does not exist, without printing the path back', async () => {
    const result = await cli(['folder', 'add', join(root, 'nowhere')])
    expect(result.code).toBe(1)
    expect(result.errors.join('\n')).toContain('could not be read')
    expect(result.errors.join('\n')).not.toContain(root)
  })

  it('removes a folder and its index together', async () => {
    const id = await addFolder()
    await cli(['index', id])
    await cli(['folder', 'remove', id])

    const status = await cli(['status', '--json'])
    const parsed = JSON.parse(status.lines.join('\n')) as { folders: unknown[] }

    expect(parsed.folders).toEqual([])
    expect((await cli(['folder', 'list'])).lines.join('\n')).toContain('No folders yet')
  })
})

describe('indexing', () => {
  it('indexes a folder and reports what it could not read', async () => {
    const id = await addFolder()
    const result = await cli(['index', id])

    expect(result.code).toBe(0)
    expect(result.lines.join('\n')).toContain('11 documents')
    expect(result.lines.join('\n')).toContain('3 unreadable')
    expect(result.errors.join('\n')).toContain('edge/invalid-utf8.txt')
  })

  it('reports an unknown folder id instead of guessing', async () => {
    const result = await cli(['index', 'ffffffffffffffff'])
    expect(result.code).toBe(1)
    expect(result.errors.join('\n')).toContain('No folder in the list has that id')
  })

  it('shows the size and the counts in status', async () => {
    const id = await addFolder()
    await cli(['index', id])

    const status = await cli(['status'])
    expect(status.lines.join('\n')).toContain('11 documents')
    expect(status.lines.join('\n')).toContain('data directory')
  })

  it('says so when a folder has never been indexed', async () => {
    await addFolder()
    expect((await cli(['status'])).lines.join('\n')).toContain('not indexed yet')
  })
})

describe('searching', () => {
  it('finds the document that discusses the query, with a citable label', async () => {
    const id = await addFolder()
    await cli(['index', id])

    const result = await cli(['search', 'reciprocal rank fusion'])
    expect(result.code).toBe(0)
    expect(result.lines.join('\n')).toContain('retrieval.md')
    expect(result.lines.join('\n')).toContain('§ Retrieval')
  })

  it('holds back when nothing clears the confidence threshold', async () => {
    const id = await addFolder()
    await cli(['index', id])

    const result = await cli(['search', 'reciprocal unrelatedterm anotherterm'])
    expect(result.lines.join('\n')).toContain('confidence threshold')
  })

  it('says there are no matches rather than inventing one', async () => {
    const id = await addFolder()
    await cli(['index', id])

    const result = await cli(['search', 'zzzznotpresent'])
    expect(result.lines.join('\n')).toContain('No matches')
  })

  it('finds nothing before anything is indexed', async () => {
    await addFolder()
    expect((await cli(['search', 'anything'])).lines.join('\n')).toContain('No matches')
  })

  it('honours --top', async () => {
    const id = await addFolder()
    await cli(['index', id])

    const result = await cli(['search', 'the', '--top', '1', '--json'])
    const parsed = JSON.parse(result.lines.join('\n')) as { hits: unknown[] }
    expect(parsed.hits).toHaveLength(1)
  })

  it('emits machine readable output that carries the citation', async () => {
    const id = await addFolder()
    await cli(['index', id])

    const result = await cli(['search', 'staging directory', '--json'])
    const parsed = JSON.parse(result.lines.join('\n')) as {
      mode: string
      confident: boolean
      hits: { filename: string; absolutePath: string; label: string }[]
    }

    expect(parsed.mode).toBe('lexical')
    expect(parsed.confident).toBe(true)
    expect(parsed.hits[0]?.filename).toBe('storage.md')
    expect(parsed.hits[0]?.absolutePath).toBe(join(root, 'notes', 'storage.md'))
    expect(parsed.hits[0]?.label).toContain('§ Storage')
  })
})

describe('answering with ask', () => {
  it('refuses an empty question', async () => {
    const result = await cli(['ask', ''])
    expect(result.code).toBe(2)
    expect(result.errors.join('\n')).toContain('usage: twigraph ask')
  })

  it('answers confident questions with grounded citations', async () => {
    const id = await addFolder()
    await cli(['index', id])

    const result = await cli(['ask', 'staging directory swap'])
    expect(result.code).toBe(0)
    expect(result.lines.join('\n')).toContain('[1]')
    expect(result.lines.join('\n')).toContain('Citations:')
    expect(result.lines.join('\n')).toContain('storage.md')
  })

  it('answers in JSON format with Answer structure', async () => {
    const id = await addFolder()
    await cli(['index', id])

    const result = await cli(['ask', 'staging directory swap', '--json'])
    expect(result.code).toBe(0)
    const answer = JSON.parse(result.lines.join('\n')) as {
      status: string
      text: string
      citations: { marker: number; filename: string }[]
      passages: { citationMarkers: number[] }[]
    }
    expect(answer.status).toBe('answered')
    expect(answer.citations.length).toBeGreaterThan(0)
    expect(answer.passages.length).toBeGreaterThan(0)
    expect(answer.text).toContain('[1]')
  })

  it('reports insufficient answer for unconfident query', async () => {
    const id = await addFolder()
    await cli(['index', id])

    const result = await cli(['ask', 'completely unrelated non-existent content query'])
    expect(result.code).toBe(0)
    expect(result.lines.join('\n')).toContain('No reliable answer found.')
  })
})

describe('deleting', () => {
  it('deletes one index and leaves the folder in the list', async () => {
    const id = await addFolder()
    await cli(['index', id])
    const removed = await cli(['delete', id])

    expect(removed.code).toBe(0)
    expect((await cli(['status'])).lines.join('\n')).toContain('not indexed yet')
    expect((await cli(['folder', 'list'])).lines.join('\n')).toContain(root)
  })

  it('leaves nothing at all behind after delete --all', async () => {
    const id = await addFolder()
    await cli(['index', id])
    const result = await cli(['delete', '--all'])

    expect(result.code).toBe(0)
    expect(existsSync(dataDir)).toBe(false)
  })

  it('refuses a folder full of the user\u2019s documents, and touches none of it', async () => {
    const documents = join(dataDir, 'Documents')
    await mkdir(join(documents, 'taxes'), { recursive: true })
    await writeFile(join(documents, 'taxes', '2024.txt'), 'private', 'utf8')
    await writeFile(join(documents, 'notes.txt'), 'private', 'utf8')

    const result = await cli(['delete', '--all'], { dataDir: documents })

    expect(result.code).toBe(1)
    expect(result.errors.join('\n')).toContain('not a twigraph data directory')
    expect(existsSync(join(documents, 'notes.txt'))).toBe(true)
    expect(existsSync(join(documents, 'taxes', '2024.txt'))).toBe(true)
  })

  it('refuses a directory that looks like a project', async () => {
    const project = join(dataDir, 'project')
    await mkdir(join(project, 'src'), { recursive: true })
    await writeFile(join(project, 'package.json'), '{}', 'utf8')
    await writeFile(join(project, 'src', 'index.ts'), 'export {}', 'utf8')

    const result = await cli(['delete', '--all'], { dataDir: project })

    expect(result.code).toBe(1)
    expect(existsSync(join(project, 'package.json'))).toBe(true)
    expect(existsSync(join(project, 'src', 'index.ts'))).toBe(true)
  })

  it('claims the data directory on the first write, and only then', async () => {
    const untouched = join(dataDir, 'untouched')
    await cli(['status'], { dataDir: untouched })
    // Merely reading must not take ownership of a directory twigraph was pointed at.
    expect(existsSync(untouched)).toBe(false)

    await cli(['folder', 'add', root], { dataDir: untouched })
    expect(existsSync(join(untouched, '.twigraph-data'))).toBe(true)
  })

  it('deletes its own files but keeps a file the user put there', async () => {
    const id = await addFolder()
    await cli(['index', id])
    await writeFile(join(dataDir, 'mine.txt'), 'not twigraph\u2019s', 'utf8')

    const result = await cli(['delete', '--all'])

    expect(result.code).toBe(0)
    expect(result.lines.join('\n')).toContain('Left')
    expect(existsSync(join(dataDir, 'mine.txt'))).toBe(true)
    expect(existsSync(join(dataDir, 'config.json'))).toBe(false)
    expect(existsSync(join(dataDir, 'indexes'))).toBe(false)
  })

  it('says there is nothing to delete when there is nothing to delete', async () => {
    expect((await cli(['delete', 'ffffffffffffffff'])).code).toBe(0)
    expect(
      (await cli(['delete', '--all'], { dataDir: join(dataDir, 'nowhere') })).lines.join('\n'),
    ).toContain('Nothing to delete')
  })
})

describe('privacy', () => {
  it('states the promise and where the data is', async () => {
    const result = await cli(['privacy'])
    expect(result.code).toBe(0)
    expect(result.lines.join('\n')).toContain('Your files stay on this device.')
    expect(result.lines.join('\n')).toContain(dataDir)
  })

  it('reports offline when asked', async () => {
    const result = await cli(['privacy', '--offline', '--json'])
    const parsed = JSON.parse(result.lines.join('\n')) as {
      offline: boolean
      allowedDestinations: string[]
    }

    expect(parsed.offline).toBe(true)
    expect(parsed.allowedDestinations).toEqual([])
  })
})

describe('the whole flow, with no network at all', () => {
  it('adds, indexes, searches and deletes without a single request', async () => {
    const guard = installNetworkGuard({ mode: 'offline' })
    try {
      const added = await cli(['folder', 'add', root])
      expect(added.code).toBe(0)

      const listed = JSON.parse((await cli(['folder', 'list', '--json'])).lines.join('\n')) as {
        folders: { id: string }[]
      }
      const id = listed.folders[0]?.id ?? ''

      expect((await cli(['index', id])).code).toBe(0)
      expect((await cli(['search', 'atomic writes'])).code).toBe(0)
      expect((await cli(['status'])).code).toBe(0)
      expect((await cli(['privacy'])).code).toBe(0)
      expect((await cli(['delete', '--all'])).code).toBe(0)

      expect(guard.attempts()).toEqual([])
      expect(guard.blocked()).toEqual([])
    } finally {
      guard.restore()
    }
  })
})

describe('data directory resolution', () => {
  it('prefers the explicit path, then the environment, then the platform default', () => {
    expect(resolveDataDir('/tmp/explicit', { TWIGRAPH_DATA_DIR: '/tmp/from-env' })).toContain(
      'explicit',
    )
    expect(resolveDataDir(undefined, { TWIGRAPH_DATA_DIR: '/tmp/from-env' })).toContain('from-env')
    expect(resolveDataDir(undefined, {})).toBe(defaultDataDir(process.platform, {}))
  })

  it('uses the location each platform expects', () => {
    expect(defaultDataDir('win32', { LOCALAPPDATA: 'C:\\Local' }, 'C:\\Users\\me')).toBe(
      join('C:\\Local', 'twigraph'),
    )
    expect(defaultDataDir('darwin', {}, '/Users/me')).toBe(
      join('/Users/me', 'Library', 'Application Support', 'twigraph'),
    )
    expect(defaultDataDir('linux', { XDG_DATA_HOME: '/xdg' }, '/home/me')).toBe(
      join('/xdg', 'twigraph'),
    )
    expect(defaultDataDir('linux', {}, '/home/me')).toBe(
      join('/home/me', '.local', 'share', 'twigraph'),
    )
  })
})
