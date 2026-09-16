/**
 * Synthetic fixtures.
 *
 * A real document never enters this repository, including inside a test. Everything here
 * is invented, deterministic, and regenerated rather than committed: the same call always
 * writes byte-identical files, so a snapshot of a parse is meaningful.
 *
 * Run it directly to look at the tree:
 *
 *   npm run fixture:generate          # writes fixtures/sample/
 *
 * Tests call `generateFixtures(dir)` into a temp directory instead, so they never depend
 * on someone having run this first.
 */

import { realpathSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const encoder = new TextEncoder()

/** A sentence long enough to be worth chunking, and dull enough to be obviously fake. */
const sentence = (index) =>
  `Record ${index} explains that the local index keeps every vector on disk.`

const longBody = (count) => Array.from({ length: count }, (_, i) => sentence(i + 1)).join(' ')

const retrievalMd = [
  '# Retrieval',
  '',
  'Retrieval happens entirely on the device. Nothing in this document is sent anywhere.',
  '',
  '## Lexical ranking',
  '',
  'BM25 is the floor of the system rather than a fallback. It needs no model download and',
  'it is deterministic, so the same query always produces the same ranking.',
  '',
  'The two parameters are k1 and b. Saturation is controlled by k1 and length',
  'normalisation by b, and the defaults are 1.2 and 0.75 respectively.',
  '',
  '## Fusion',
  '',
  'Rank lists are combined with reciprocal rank fusion:',
  '',
  '- each retriever contributes 1 / (k + rank);',
  '- k is 60;',
  '- raw scores are never added together.',
  '',
  '```ts',
  'const fused = ranks.reduce((total, rank) => total + 1 / (60 + rank), 0)',
  '```',
  '',
  '## Confidence',
  '',
  'A weak query is refused instead of guessed at. The threshold is minScore.',
].join('\n')

const storageMd = [
  '# Storage',
  '',
  'Everything lives under one user-visible directory that the user can inspect and delete.',
  '',
  '## Atomic writes',
  '',
  'A write goes to a temporary file and is then renamed into place. A torn write therefore',
  'leaves the previous file intact, which matters because a half-written index is worse',
  'than a missing one.',
  '',
  '## Staging',
  '',
  'A re-index builds a staging directory and swaps it in. A live index is never mutated in',
  'place, so a search either sees the whole old index or the whole new one.',
  '',
  '## Deduplication',
  '',
  'Identical content is embedded once, but a document record is kept per folder so a',
  'citation points at the file the user actually chose.',
].join('\n')

const privacyTxt = [
  'Privacy notes',
  '',
  'There is no account, no cloud database and no telemetry. The application can reach the',
  'network exactly once, to download a local embedding model, and only when the user asks',
  'for it. Without a model the product still works, because lexical search needs nothing.',
  '',
  'Setting the offline flag disables every network path, loopback included.',
].join('\n')

const embeddingsTxt = [
  'Embeddings notes',
  '',
  'The embedding provider is loaded lazily so that a user who never prepares a model never',
  'loads the native runtime. Vectors are normalised to unit length when they are written,',
  'which turns cosine similarity into a plain dot product.',
  '',
  'A vector written by one model is not comparable with a vector written by another, so the',
  'model id and dtype are stored next to the vectors and checked when they are read.',
].join('\n')

const headingsOnlyMd = ['# Alpha', '', '## Beta', '', '### Gamma', ''].join('\n')

/** Invalid UTF-8: a continuation byte with no lead byte. */
const invalidUtf8 = Buffer.from([0x68, 0x69, 0x20, 0xc3, 0x28, 0x20, 0x62, 0x79, 0x65])

/**
 * The generated tree.
 *
 * `edge/` holds the cases every parser has to report rather than crash on. `.git/` and
 * `node_modules/` exist so the folder scan has something it must refuse to walk into.
 */
const FILES = [
  { path: 'notes/retrieval.md', text: retrievalMd },
  { path: 'notes/storage.md', text: storageMd },
  { path: 'notes/long.md', text: `# Long document\n\n${longBody(220)}\n` },
  { path: 'plain/privacy.txt', text: privacyTxt },
  { path: 'plain/embeddings.txt', text: embeddingsTxt },
  {
    path: 'deep/one/two/nested.md',
    text: '# Nested\n\nThe nesting is only here to test the walk.\n',
  },
  { path: 'edge/empty.txt', text: '' },
  { path: 'edge/whitespace-only.txt', text: '   \n\n\t\n   ' },
  { path: 'edge/headings-only.md', text: headingsOnlyMd },
  {
    path: 'edge/nested-list.md',
    text: '# Lists\n\n- first item\n  - nested item\n- second item\n',
  },
  { path: 'edge/unsupported.csv', text: 'a,b,c\n1,2,3\n' },
  { path: 'edge/no-extension', text: 'A file with no extension at all.\n' },
  { path: 'edge/invalid-utf8.txt', bytes: invalidUtf8 },
  {
    path: '.hidden/secret.md',
    text: '# Hidden\n\nA hidden directory is not part of the folder.\n',
  },
  { path: 'node_modules/pkg/index.md', text: '# Dependency\n\nThis is never indexed.\n' },
  { path: '.git/config', text: '[core]\n\trepositoryformatversion = 0\n' },
]

/**
 * Writes the whole fixture tree into `targetDir`, replacing whatever was there.
 *
 * Returns the list of relative paths it wrote, in a fixed order, so a caller can assert on
 * the tree without walking it.
 */
export async function generateFixtures(targetDir) {
  await rm(targetDir, { recursive: true, force: true })

  for (const file of FILES) {
    const destination = join(targetDir, file.path)
    await mkdir(dirname(destination), { recursive: true })
    await writeFile(destination, file.bytes === undefined ? encoder.encode(file.text) : file.bytes)
  }

  return FILES.map((file) => file.path)
}

/** Every path the generator writes, without writing anything. */
export const fixturePaths = FILES.map((file) => file.path)

/** The directories under the target that the scan must refuse to descend into. */
export const ignoredDirectories = ['node_modules', '.git', '.hidden']

const invokedDirectly =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])

if (invokedDirectly) {
  const target = join(dirname(fileURLToPath(import.meta.url)), 'sample')
  const written = await generateFixtures(target)
  console.log(`Wrote ${written.length} fixtures to ${target}`)
  for (const path of written) console.log(`  ${path}`)
}
