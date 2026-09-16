import { createHash } from 'node:crypto'
import { parse, resolve, sep } from 'node:path'

/**
 * Folder identity.
 *
 * The id is derived from the path rather than generated, so the same folder always maps to
 * the same index directory. That is what makes re-indexing idempotent and what makes
 * "delete this folder" a single directory removal.
 */

/** The path as the user should see it: absolute, no trailing separator, root preserved. */
export function canonicalFolderPath(input: string): string {
  const absolute = resolve(input)
  if (absolute === parse(absolute).root) return absolute
  return absolute.endsWith(sep) ? absolute.slice(0, -1) : absolute
}

/**
 * The form used for identity comparison. Windows paths are case-insensitive, so folding
 * case there stops `C:\Docs` and `c:\docs` from being indexed twice.
 */
function identityKey(absolutePath: string, platform: NodeJS.Platform): string {
  const unified = absolutePath.split('\\').join('/').replace(/\/+$/, '')
  return platform === 'win32' ? unified.toLowerCase() : unified
}

export function folderIdFor(
  folderPath: string,
  platform: NodeJS.Platform = process.platform,
): string {
  return createHash('sha256').update(identityKey(folderPath, platform)).digest('hex').slice(0, 16)
}
