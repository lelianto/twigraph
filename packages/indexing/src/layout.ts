import { join } from 'node:path'

/**
 * The version of the on-disk index format.
 *
 * Rule: reject, never migrate. A manifest this build does not understand is reported as
 * `INDEX_CORRUPT` and the remedy is a re-index, which is always safe because the source
 * documents are still where the user left them. A half-migrated index is worse than a
 * missing one: it looks fine and returns the wrong neighbours.
 */
export const INDEX_SCHEMA_VERSION = 1

export const INDEXES_DIRECTORY = 'indexes'

export function indexesRoot(dataDir: string): string {
  return join(dataDir, INDEXES_DIRECTORY)
}

export function indexDirectory(dataDir: string, folderId: string): string {
  return join(indexesRoot(dataDir), folderId)
}

/** Where a re-index is built. Never read by a search. */
export function stagingDirectory(dataDir: string, folderId: string): string {
  return `${indexDirectory(dataDir, folderId)}.staging`
}

/** The previous index, kept only for the moment between two renames. */
export function previousDirectory(dataDir: string, folderId: string): string {
  return `${indexDirectory(dataDir, folderId)}.old`
}
