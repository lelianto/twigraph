import { createHash } from 'node:crypto'

const ID_LENGTH = 16

function shortHash(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, ID_LENGTH)
}

/**
 * A document's identity inside a folder.
 *
 * Derived from the folder id and the relative path rather than from a counter, so the same
 * file keeps the same id across runs and a re-index produces a byte-identical index. The
 * content hash is deliberately not part of it: editing a file must update the document it
 * already is, not create a second one.
 */
export function documentIdFor(folderId: string, relativePath: string): string {
  return shortHash(`${folderId}:${relativePath}`)
}
