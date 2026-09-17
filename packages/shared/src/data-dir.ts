import { mkdir, readFile, readdir, rmdir, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { TwigraphError } from './errors'

/**
 * Ownership of the data directory.
 *
 * The directory can be pointed anywhere by an environment variable, so "delete everything"
 * must never be able to mean "delete whatever the user happened to point us at". The marker
 * is what makes the directory recognisably twigraph's: it is written the first time twigraph
 * writes anything, and deletion refuses to touch a directory that does not carry it.
 */

export const DATA_MARKER_FILE = '.twigraph-data'
export const DATA_MARKER_APPLICATION = 'twigraph'
export const DATA_MARKER_VERSION = 1

/**
 * Everything twigraph creates directly under the data directory.
 *
 * Deletion removes exactly these, and nothing else, so a file the user put there for their
 * own reasons survives. That is the difference between clearing an index and clearing a
 * disk, and it holds even if the marker check were somehow passed.
 */
export const DATA_ARTIFACTS: readonly string[] = [
  'config.json',
  'config.json.tmp',
  'indexes',
  'models',
  DATA_MARKER_FILE,
]

export interface DataMarker {
  readonly application: string
  readonly schemaVersion: number
}

export function dataMarkerPath(dataDir: string): string {
  return join(dataDir, DATA_MARKER_FILE)
}

async function statOrNull(path: string): Promise<Awaited<ReturnType<typeof stat>> | null> {
  try {
    return await stat(path)
  } catch {
    return null
  }
}

/** The marker as it was written, or `null` when there is not a usable one. */
export async function readDataMarker(dataDir: string): Promise<DataMarker | null> {
  let raw: string
  try {
    raw = await readFile(dataMarkerPath(dataDir), 'utf8')
  } catch {
    return null
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }

  if (parsed === null || typeof parsed !== 'object') return null
  const marker = parsed as { application?: unknown; schemaVersion?: unknown }
  if (marker.application !== DATA_MARKER_APPLICATION) return null
  if (typeof marker.schemaVersion !== 'number') return null

  return { application: DATA_MARKER_APPLICATION, schemaVersion: marker.schemaVersion }
}

export async function isTwigraphDataDirectory(dataDir: string): Promise<boolean> {
  return (await readDataMarker(dataDir)) !== null
}

/**
 * Brings the data directory into being and stamps it as twigraph's.
 *
 * Called from every path that writes into the directory, so the first write is also the
 * one that claims it. Read paths never call it, so running `status` against a directory
 * twigraph does not own cannot quietly take ownership of it.
 *
 * A marker that is missing or unreadable is rewritten rather than trusted: the failure
 * mode of a corrupt marker is that deletion refuses to run, and silently repairing a
 * torn write is better than leaving the user stuck.
 */
export async function ensureDataDirectory(dataDir: string): Promise<void> {
  await mkdir(dataDir, { recursive: true })
  if (await isTwigraphDataDirectory(dataDir)) return

  const marker: DataMarker = {
    application: DATA_MARKER_APPLICATION,
    schemaVersion: DATA_MARKER_VERSION,
  }
  await writeFile(dataMarkerPath(dataDir), `${JSON.stringify(marker, null, 2)}\n`, 'utf8')
}

export interface DataDeletion {
  /** The artifact names that were actually present and are now gone. */
  readonly removed: readonly string[]
  readonly directoryRemoved: boolean
  /** What is left in the directory, when it was not empty and therefore was not removed. */
  readonly remaining: readonly string[]
}

/**
 * Deletes what twigraph stored, and only what twigraph stored.
 *
 * Two independent guarantees, because this is irreversible:
 *
 * 1. the directory must carry a valid marker, so a directory twigraph never wrote to is
 *    refused outright;
 * 2. only the named artifacts are removed, and the directory itself is removed with
 *    `rmdir`, which fails on a non-empty one. There is no recursive delete on a
 *    user-supplied path anywhere in this function.
 */
export async function deleteDataDirectory(dataDir: string): Promise<DataDeletion> {
  const info = await statOrNull(dataDir)
  if (info === null) {
    return { removed: [], directoryRemoved: false, remaining: [] }
  }
  if (!info.isDirectory()) {
    throw new TwigraphError(
      'INTERNAL',
      'The data directory is not a directory, so nothing was deleted',
    )
  }
  if (!(await isTwigraphDataDirectory(dataDir))) {
    throw new TwigraphError(
      'INTERNAL',
      'That directory is not a twigraph data directory, so nothing was deleted',
      { detail: { dataDir } },
    )
  }

  const removed: string[] = []
  for (const name of DATA_ARTIFACTS) {
    const target = join(dataDir, name)
    if ((await statOrNull(target)) === null) continue
    await rm(target, { recursive: true, force: true })
    removed.push(name)
  }

  let directoryRemoved = false
  try {
    await rmdir(dataDir)
    directoryRemoved = true
  } catch {
    directoryRemoved = false
  }

  const remaining = directoryRemoved ? [] : await readdir(dataDir).catch(() => [])

  return { removed, directoryRemoved, remaining }
}
