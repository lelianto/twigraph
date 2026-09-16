import type { DocumentParser } from '@mulat/shared'

/**
 * A parser, plus the version of its output shape.
 *
 * `DocumentParser` is frozen in `@mulat/shared` and deliberately carries no version. The
 * version lives here instead, because it exists for one reason only: an `IndexManifest`
 * records which parser versions produced it, and a build that meets an unknown version
 * forces a re-index rather than mixing old and new chunks in one index.
 */
export interface VersionedParser extends DocumentParser {
  readonly version: string
}
