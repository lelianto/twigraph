import { readFile } from 'node:fs/promises'
import { basename, extname } from 'node:path'

import { TwigraphError } from '@twigraph/shared'
import type { Block, ParsedDocument, ParseInput } from '@twigraph/shared'

const UTF8 = new TextDecoder('utf-8', { fatal: true })
const BOM = '\uFEFF'

export function normalizeNewlines(text: string): string {
  return text.replace(/\r\n?/g, '\n')
}

/**
 * Reads a document as text, or reports why it could not be.
 *
 * Decoding is strict on purpose: `TextDecoder` in its default mode would turn undecodable
 * bytes into replacement characters, which then travel all the way into an index and a
 * citation as text the user never wrote. Strict decoding turns that into a reported
 * outcome instead.
 *
 * The message never contains the path, because `toWireError()` only drops a path for an
 * error it did not create — a `TwigraphError` message is shown to the user as it stands.
 */
export async function readDocumentText(input: ParseInput): Promise<string> {
  let bytes: Uint8Array
  try {
    bytes = await readFile(input.absolutePath)
  } catch (error) {
    throw new TwigraphError('PARSE_FAILED', 'The file could not be read', { cause: error })
  }

  let text: string
  try {
    text = UTF8.decode(bytes)
  } catch (error) {
    throw new TwigraphError('PARSE_FAILED', 'The file is not valid UTF-8 text', { cause: error })
  }

  const withoutBom = text.startsWith(BOM) ? text.slice(BOM.length) : text
  return normalizeNewlines(withoutBom)
}

/** Every parser reports an empty document the same way. */
export function emptyDocument(): never {
  throw new TwigraphError('PARSE_EMPTY', 'The document has no text to index')
}

export function assembleDocument(
  input: ParseInput,
  blocks: readonly Block[],
  title: string | undefined,
): ParsedDocument {
  const filename = basename(input.absolutePath)
  return {
    metadata: {
      filename,
      relativePath: input.relativePath,
      absolutePath: input.absolutePath,
      extension: extname(filename).toLowerCase(),
      sizeBytes: input.sizeBytes,
      modifiedAtMs: input.modifiedAtMs,
      contentHash: input.contentHash,
      ...(title === undefined || title === '' ? {} : { title }),
      parseWarnings: [],
    },
    blocks,
  }
}

/** The title a document is known by: its first line that is not blank. */
export function firstNonBlankLine(text: string): string | undefined {
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (trimmed !== '') return trimmed
  }
  return undefined
}
