import { createHash } from 'node:crypto'
import { readFile, readdir, stat } from 'node:fs/promises'
import { extname, join, relative, sep } from 'node:path'

import { MulatError } from '@mulat/shared'

import { normalizeExtension } from './registry'

/** 25 MiB. A larger file is reported, not read into memory. */
export const DEFAULT_MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024

export const DEFAULT_IGNORED_DIRECTORIES: readonly string[] = ['node_modules', '.git']

export type SkipReason =
  | 'unsupported-extension'
  | 'too-large'
  | 'symlink'
  | 'unreadable'
  /** A directory the scan refuses to descend into, such as `node_modules` or `.git`. */
  | 'ignored-directory'
  /** A dot file or dot directory. */
  | 'hidden'

export interface ScannedFile {
  readonly absolutePath: string
  /** Always slash separated, so an index built on Windows matches one built on Linux. */
  readonly relativePath: string
  /** Lowercase, with the leading dot. Empty when the file has no extension. */
  readonly extension: string
  readonly sizeBytes: number
  readonly modifiedAtMs: number
  readonly contentHash: string
}

export interface ScanSkip {
  readonly relativePath: string
  readonly reason: SkipReason
}

export interface ScanResult {
  readonly root: string
  readonly files: readonly ScannedFile[]
  readonly skipped: readonly ScanSkip[]
}

export interface ScanOptions {
  readonly ignoreDirectories?: readonly string[]
  /** Hidden files and directories are skipped by default, `.git` included. */
  readonly ignoreHidden?: boolean
  readonly maxFileSizeBytes?: number
  /** When omitted, every extension is accepted. */
  readonly supportedExtensions?: readonly string[]
}

/** Code-unit order, never the locale's. `localeCompare` would make the order machine
 * dependent, and chunk ordinals would then differ between two machines on one folder. */
function byPath(a: string, b: string): number {
  if (a === b) return 0
  return a < b ? -1 : 1
}

function toRelativePath(root: string, absolutePath: string): string {
  return relative(root, absolutePath).split(sep).join('/')
}

async function assertDirectory(root: string): Promise<void> {
  let info
  try {
    info = await stat(root)
  } catch (error) {
    throw new MulatError('FOLDER_UNREADABLE', 'The folder could not be read', { cause: error })
  }
  if (!info.isDirectory()) {
    throw new MulatError('FOLDER_UNREADABLE', 'The path is not a folder')
  }
}

/**
 * Walks a folder and reports every file it is willing to index.
 *
 * Skipping is a reported outcome, never a silent one: everything the scan declined is named
 * with a reason, including the dot files it ignores and the directories it refuses to walk
 * into. A user whose documents live in a hidden folder gets told that, rather than getting
 * an empty result and no explanation.
 *
 * The report is one entry per skipped entry, not one per file inside it: a `node_modules`
 * directory is a single line, not fifteen thousand.
 *
 * Nothing here reads a file's content except to hash it, and a file above the size limit is
 * not read at all.
 *
 * Symbolic links are skipped rather than followed. Following them is how a scan escapes
 * the folder the user chose, and how a link that points at its own parent turns a walk
 * into an infinite one.
 */
export async function scanFolder(root: string, options: ScanOptions = {}): Promise<ScanResult> {
  const ignoreDirectories = new Set(options.ignoreDirectories ?? DEFAULT_IGNORED_DIRECTORIES)
  const ignoreHidden = options.ignoreHidden ?? true
  const maxFileSizeBytes = options.maxFileSizeBytes ?? DEFAULT_MAX_FILE_SIZE_BYTES
  const supported =
    options.supportedExtensions === undefined
      ? null
      : new Set(options.supportedExtensions.map(normalizeExtension))

  await assertDirectory(root)

  const files: ScannedFile[] = []
  const skipped: ScanSkip[] = []
  const pending: string[] = [root]

  while (pending.length > 0) {
    const current = pending.pop()
    if (current === undefined) break

    let entries
    try {
      entries = await readdir(current, { withFileTypes: true })
    } catch {
      skipped.push({ relativePath: toRelativePath(root, current), reason: 'unreadable' })
      continue
    }

    entries.sort((a, b) => byPath(a.name, b.name))

    for (const entry of entries) {
      const absolutePath = join(current, entry.name)
      const relativePath = toRelativePath(root, absolutePath)

      if (entry.isSymbolicLink()) {
        skipped.push({ relativePath, reason: 'symlink' })
        continue
      }

      if (entry.isDirectory()) {
        if (ignoreDirectories.has(entry.name)) {
          skipped.push({ relativePath, reason: 'ignored-directory' })
          continue
        }
        if (ignoreHidden && entry.name.startsWith('.')) {
          skipped.push({ relativePath, reason: 'hidden' })
          continue
        }
        pending.push(absolutePath)
        continue
      }

      if (ignoreHidden && entry.name.startsWith('.')) {
        skipped.push({ relativePath, reason: 'hidden' })
        continue
      }

      if (!entry.isFile()) continue

      const extension = extname(entry.name).toLowerCase()
      if (supported !== null && !supported.has(extension)) {
        skipped.push({ relativePath, reason: 'unsupported-extension' })
        continue
      }

      let info
      try {
        info = await stat(absolutePath)
      } catch {
        skipped.push({ relativePath, reason: 'unreadable' })
        continue
      }

      if (info.size > maxFileSizeBytes) {
        skipped.push({ relativePath, reason: 'too-large' })
        continue
      }

      let contentHash: string
      try {
        contentHash = createHash('sha256')
          .update(await readFile(absolutePath))
          .digest('hex')
      } catch {
        skipped.push({ relativePath, reason: 'unreadable' })
        continue
      }

      files.push({
        absolutePath,
        relativePath,
        extension,
        sizeBytes: info.size,
        modifiedAtMs: Math.trunc(info.mtimeMs),
        contentHash,
      })
    }
  }

  files.sort((a, b) => byPath(a.relativePath, b.relativePath))
  skipped.sort((a, b) => byPath(a.relativePath, b.relativePath))

  return { root, files, skipped }
}
