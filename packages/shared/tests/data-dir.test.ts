import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, parse, resolve } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  DATA_MARKER_FILE,
  dataMarkerPath,
  deleteDataDirectory,
  ensureDataDirectory,
  isTwigraphDataDirectory,
  readDataMarker,
} from '../src/data-dir'
import { TwigraphError } from '../src/errors'

let base = ''
let dataDir = ''

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'twigraph-datadir-'))
  dataDir = join(base, 'twigraph')
})

afterEach(async () => {
  await rm(base, { recursive: true, force: true })
})

/** A directory that looks like something the user cares about, and is not twigraph's. */
async function documentsLike(): Promise<string> {
  const directory = join(base, 'Documents')
  await mkdir(join(directory, 'taxes'), { recursive: true })
  await writeFile(join(directory, 'taxes', '2024.txt'), 'private', 'utf8')
  await writeFile(join(directory, 'notes.txt'), 'private', 'utf8')
  return directory
}

describe('claiming a directory', () => {
  it('creates the directory and a marker the first time it is needed', async () => {
    await ensureDataDirectory(dataDir)

    expect(await isTwigraphDataDirectory(dataDir)).toBe(true)
    expect(await readDataMarker(dataDir)).toEqual({ application: 'twigraph', schemaVersion: 1 })
  })

  it('writes the marker as readable JSON with a trailing newline', async () => {
    await ensureDataDirectory(dataDir)
    const raw = await readFile(dataMarkerPath(dataDir), 'utf8')

    expect(raw.endsWith('\n')).toBe(true)
    expect(JSON.parse(raw)).toMatchObject({ application: 'twigraph' })
  })

  it('leaves an existing valid marker alone', async () => {
    await ensureDataDirectory(dataDir)
    const before = await readFile(dataMarkerPath(dataDir), 'utf8')

    await ensureDataDirectory(dataDir)
    expect(await readFile(dataMarkerPath(dataDir), 'utf8')).toBe(before)
  })

  it('repairs a marker that was torn by a half-finished write', async () => {
    await mkdir(dataDir, { recursive: true })
    await writeFile(dataMarkerPath(dataDir), '{ this is not json', 'utf8')

    await ensureDataDirectory(dataDir)
    expect(await isTwigraphDataDirectory(dataDir)).toBe(true)
  })

  it('does not claim a directory it was merely pointed at', async () => {
    const documents = await documentsLike()

    expect(await isTwigraphDataDirectory(documents)).toBe(false)
    expect(await readdir(documents)).toEqual(['notes.txt', 'taxes'])
  })
})

describe('reading a marker', () => {
  it('reports nothing when there is no marker', async () => {
    await mkdir(dataDir, { recursive: true })
    expect(await readDataMarker(dataDir)).toBeNull()
  })

  it('reports nothing for a marker that belongs to something else', async () => {
    await mkdir(dataDir, { recursive: true })
    await writeFile(dataMarkerPath(dataDir), JSON.stringify({ application: 'other' }), 'utf8')

    expect(await readDataMarker(dataDir)).toBeNull()
  })

  it('reports nothing for a marker with no schema version', async () => {
    await mkdir(dataDir, { recursive: true })
    await writeFile(dataMarkerPath(dataDir), JSON.stringify({ application: 'twigraph' }), 'utf8')

    expect(await readDataMarker(dataDir)).toBeNull()
  })

  it('reports nothing for a marker that is not an object', async () => {
    await mkdir(dataDir, { recursive: true })
    await writeFile(dataMarkerPath(dataDir), '"twigraph"', 'utf8')

    expect(await readDataMarker(dataDir)).toBeNull()
  })

  it('reports nothing for a directory that does not exist', async () => {
    expect(await readDataMarker(join(base, 'nowhere'))).toBeNull()
  })
})

describe('refusing to delete a directory twigraph does not own', () => {
  it('refuses a folder full of the user\u2019s documents, and leaves all of it intact', async () => {
    const documents = await documentsLike()

    await expect(deleteDataDirectory(documents)).rejects.toBeInstanceOf(TwigraphError)
    await expect(deleteDataDirectory(documents)).rejects.toMatchObject({ code: 'INTERNAL' })

    expect((await readdir(documents)).sort()).toEqual(['notes.txt', 'taxes'])
    expect(await readFile(join(documents, 'taxes', '2024.txt'), 'utf8')).toBe('private')
  })

  it('refuses a directory that looks like a project', async () => {
    const project = join(base, 'project')
    await mkdir(join(project, 'src'), { recursive: true })
    await writeFile(join(project, 'package.json'), '{}', 'utf8')
    await writeFile(join(project, 'src', 'index.ts'), 'export {}', 'utf8')

    await expect(deleteDataDirectory(project)).rejects.toMatchObject({ code: 'INTERNAL' })
    expect((await readdir(project)).sort()).toEqual(['package.json', 'src'])
  })

  it('refuses the repository this test is running in', async () => {
    // A pure read: the check is asserted without ever offering the real repository for
    // deletion, because a test that could delete the working tree is not a test.
    expect(await isTwigraphDataDirectory(process.cwd())).toBe(false)
    expect(await isTwigraphDataDirectory(homedir())).toBe(false)
    expect(await isTwigraphDataDirectory(parse(resolve(process.cwd())).root)).toBe(false)
  })

  it('refuses a home directory', async () => {
    expect(await isTwigraphDataDirectory(homedir())).toBe(false)
  })

  it('refuses a path that is a file rather than a directory', async () => {
    const file = join(base, 'a-file.txt')
    await writeFile(file, 'not a directory', 'utf8')

    await expect(deleteDataDirectory(file)).rejects.toMatchObject({ code: 'INTERNAL' })
    expect(await readFile(file, 'utf8')).toBe('not a directory')
  })
})

describe('deleting a directory twigraph does own', () => {
  it('removes its own artifacts and then the directory', async () => {
    await ensureDataDirectory(dataDir)
    await mkdir(join(dataDir, 'indexes'), { recursive: true })
    await mkdir(join(dataDir, 'models'), { recursive: true })
    await writeFile(join(dataDir, 'config.json'), '{}', 'utf8')

    const deletion = await deleteDataDirectory(dataDir)

    expect(deletion.directoryRemoved).toBe(true)
    expect([...deletion.removed].sort()).toEqual(
      ['config.json', 'indexes', 'models', DATA_MARKER_FILE].sort(),
    )
    await expect(readdir(dataDir)).rejects.toThrow()
  })

  it('keeps a file the user put there, and keeps the directory that holds it', async () => {
    await ensureDataDirectory(dataDir)
    await mkdir(join(dataDir, 'indexes'), { recursive: true })
    await writeFile(join(dataDir, 'mine.txt'), 'not twigraph\u2019s', 'utf8')

    const deletion = await deleteDataDirectory(dataDir)

    expect(deletion.directoryRemoved).toBe(false)
    expect(deletion.remaining).toEqual(['mine.txt'])
    expect(await readdir(dataDir)).toEqual(['mine.txt'])
    expect(await readFile(join(dataDir, 'mine.txt'), 'utf8')).toBe('not twigraph\u2019s')
  })

  it('reports nothing to delete for a directory that is not there', async () => {
    expect(await deleteDataDirectory(join(base, 'nowhere'))).toEqual({
      removed: [],
      directoryRemoved: false,
      remaining: [],
    })
  })

  it('is idempotent', async () => {
    await ensureDataDirectory(dataDir)
    await deleteDataDirectory(dataDir)

    await expect(deleteDataDirectory(dataDir)).resolves.toEqual({
      removed: [],
      directoryRemoved: false,
      remaining: [],
    })
  })

  it('succeeds on a claimed but empty directory, removing the directory itself', async () => {
    await ensureDataDirectory(dataDir)
    const deletion = await deleteDataDirectory(dataDir)

    expect(deletion.removed).toEqual([DATA_MARKER_FILE])
    expect(deletion.directoryRemoved).toBe(true)
  })
})
