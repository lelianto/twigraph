import { TwigraphError } from '@twigraph/shared'

import type { VersionedParser } from './parser'
import { createHtmlParser } from './parsers/html'
import { createMarkdownParser } from './parsers/markdown'
import { createTextParser } from './parsers/text'

/** `md`, `.md` and `.MD` all mean the same extension. */
export function normalizeExtension(extension: string): string {
  const trimmed = extension.trim().toLowerCase()
  if (trimmed === '') return ''
  return trimmed.startsWith('.') ? trimmed : `.${trimmed}`
}

export interface ParserRegistry {
  /** Throws when a parser id or one of its extensions is already claimed. */
  register(parser: VersionedParser): void
  forExtension(extension: string): VersionedParser | null
  readonly ids: readonly string[]
  readonly extensions: readonly string[]
  readonly versions: Readonly<Record<string, string>>
}

/**
 * The one place that knows a file format exists.
 *
 * Everything downstream asks this registry for a parser rather than branching on an
 * extension itself, which is what keeps chunking, storage and retrieval format-agnostic.
 */
export function createParserRegistry(parsers: readonly VersionedParser[] = []): ParserRegistry {
  const byId = new Map<string, VersionedParser>()
  const byExtension = new Map<string, VersionedParser>()

  const register = (parser: VersionedParser): void => {
    if (byId.has(parser.id)) {
      throw new TwigraphError('INTERNAL', `Two parsers claim the id ${parser.id}`)
    }
    for (const extension of parser.extensions) {
      const normalized = normalizeExtension(extension)
      if (byExtension.has(normalized)) {
        throw new TwigraphError('INTERNAL', `Two parsers claim the extension ${normalized}`)
      }
    }
    byId.set(parser.id, parser)
    for (const extension of parser.extensions) {
      byExtension.set(normalizeExtension(extension), parser)
    }
  }

  for (const parser of parsers) register(parser)

  return {
    register,
    forExtension: (extension: string) => byExtension.get(normalizeExtension(extension)) ?? null,
    get ids(): readonly string[] {
      return [...byId.keys()].sort()
    },
    get extensions(): readonly string[] {
      return [...byExtension.keys()].filter((key) => key !== '').sort()
    },
    get versions(): Readonly<Record<string, string>> {
      const versions: Record<string, string> = {}
      for (const id of [...byId.keys()].sort()) {
        const parser = byId.get(id)
        if (parser !== undefined) versions[id] = parser.version
      }
      return versions
    },
  }
}

/** A fresh array each call, so a caller cannot mutate the shared set. */
export function defaultParsers(): readonly VersionedParser[] {
  return [createMarkdownParser(), createTextParser(), createHtmlParser()]
}
