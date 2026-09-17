# twigraph architecture

Two promises shape every decision in this document:

1. **The user's files stay on the device.** No upload, no telemetry, no cloud fallback.
2. **An answer is only ever made of retrieved text.** No answer without a citation.

Everything below exists to make those two promises testable rather than aspirational.

## Package boundaries

```
packages/shared              contracts, config, errors, citation labels, grounding invariant
packages/document-ingestion  folder scan -> Block[]            (parsers live behind a registry)
packages/indexing            Block[] -> ChunkRecord[] -> on-disk index
packages/retrieval           query -> ranked hits -> SearchResult
apps/cli                     the headless product
apps/mcp                     read-only stdio adapter over the same local index
apps/desktop                 an Electron window over the same engine and the same index
```

Dependencies point one way only: `shared` is imported by everything and imports nothing
from this workspace. `retrieval` never reads the filesystem directly — it works on records
an `IndexStore` handed it. That is what lets the whole retrieval path be tested without a
disk.

The MCP adapter exposes search, index status, and exact chunk lookup. It never scans source
folders or opens original documents: every result comes from an index the user explicitly
built through twigraph. All tools are read-only and use stdio, so the adapter opens no
listening port and adds no network path.

Parsers are the only place that knows a file format exists. There is no
`if (extension === '.pdf')` anywhere outside the parser registry.

The folder registry — the list of folders the user chose — lives in `shared` too, in
`folder-registry.ts`. It implements the `FolderRegistry` contract that `shared` itself
declares, and it persists through `shared`'s own `loadConfig`/`saveConfig`, so it belongs
next to them rather than in a package of its own. It only ever writes the list; deleting an
index is the store's job, and the CLI calls both.

## The shape everything speaks

Parsers emit `Block`s; chunking, citations and the UI work on `Block`s:

```ts
Block = { kind: 'heading' | 'paragraph' | 'list' | 'table' | 'code'; level?; text; page? }
```

A field that only one parser can fill goes through the block, never into a new core shape.

## Local data directory

One user-visible directory holds everything. The CLI resolves it in this order:

1. `--data-dir <path>`;
2. `TWIGRAPH_DATA_DIR` environment variable;
3. the platform default:
   - Windows — `%LOCALAPPDATA%\twigraph`
   - macOS — `~/Library/Application Support/twigraph`
   - Linux — `$XDG_DATA_HOME/twigraph`, else `~/.local/share/twigraph`

```
<dataDir>/
  .twigraph-data                  the marker that proves this directory is twigraph's
  config.json                  versioned, validated, atomically written
  indexes/
    <folderId>/
      manifest.json            schema version, counts, parser versions, embedding signature
      documents.jsonl          one DocumentRecord per line, indexed and failed alike
      chunks.jsonl             one ChunkRecord per line, in document then ordinal order
      vectors.bin              optional; absent when the index is BM25-only
      vectors.meta.json        model id, dimension, dtype — absent when vectors.bin is
    <folderId>.staging/        a re-index being built; never read by a search
    <folderId>.old/            the previous index, kept until the swap succeeds
  models/                      a prepared embedding model, only if the user asked for one
```

`<folderId>` is `folderIdFor()` from `shared`: a 16-hex-character SHA-256 prefix of the
canonical path, case-folded on Windows. It is derived, never generated, so the same folder
always maps to the same directory and "delete this folder" is one directory removal.

## Index formats

`documents.jsonl` and `chunks.jsonl` are JSON Lines: one compact object per line, field
order fixed by the writer. Determinism is a property of the writer, not of the reader —
identical input must produce a byte-identical file.

`manifest.json` is pretty-printed with two spaces because a human will read it when
something is wrong.

The manifest is wrapped in an envelope, because `IndexManifest` in `@twigraph/shared` is a
frozen contract that has no `schemaVersion` field and should not grow one:

```jsonc
{
  "schemaVersion": 1,
  "manifest": {
    "folderId": "00e33ec675196cbd",
    "folderPath": "C:\\Users\\me\\Documents",
    "builtAtMs": 1700000000000,
    "parserVersions": { "markdown": "1", "text": "1" },
    "documentCount": 12,
    "chunkCount": 340,
    "failedCount": 2,
    "embedding": null
  }
}
```

`serialize.ts` sorts object keys at every depth, so determinism is a property of the
writer rather than a promise the caller has to keep. Two identical indexes produce
byte-identical files no matter what order a caller built its objects in.

`builtAtMs` is supplied by the caller as a clock value. The engine never calls
`Date.now()` itself, so a test can pin it and the artifact stays reproducible.

`parserVersions` records the id and version of every parser that contributed. A parser
whose output shape changes bumps its version, and a manifest naming a version this build
does not have forces a re-index rather than a silent mix of old and new chunks.

`embedding` is `null` for a BM25-only index. When vectors exist it carries
`{ modelId, dim, dtype }`; vectors written by a different model are not comparable, so a
mismatch forces a re-index instead of returning meaningless neighbours.

## Schema versioning

`schemaVersion` is an integer owned by this document. The rule is **reject, do not
migrate**:

- a manifest with a `schemaVersion` this build does not understand is reported as
  `INDEX_CORRUPT`, and the remedy is a re-index, which is always safe because the source
  documents are still on disk;
- there is no silent upgrade path, because a half-migrated index is worse than a missing
  one — it looks fine and returns wrong neighbours.

The one exception is a missing index, which is the normal first-run state. Store reads
return `null` for a missing manifest and empty collections for missing records; callers
present that as “not indexed yet”, not as an error.

## Writing an index

An index is never mutated in place.

1. Scan the folder, parse, chunk, and write everything into `indexes/<folderId>.staging/`.
2. Only when every file in the staging directory is complete: rename `indexes/<folderId>`
   to `indexes/<folderId>.old` (skipped if there is nothing to replace).
3. Rename `indexes/<folderId>.staging` to `indexes/<folderId>`.
4. Remove `indexes/<folderId>.old`.

Every individual file is written as `<name>.tmp` and then renamed, so a torn write leaves
the previous file intact. A crash between steps 2 and 3 leaves the old index renamed but
present, and the next successful re-index cleans it up. A crash during step 1 leaves only
a staging directory, which is discarded, not read.

The consequence is that a search running against a live index either sees the whole old
index or the whole new one, never a mixture.

A run can be cancelled. Cancellation is cooperative and checked at every file boundary, so a
cancelled run stops between documents rather than in the middle of one. The staging directory is
created only inside `replaceIndex`, so throwing before it is reached is what guarantees that a
cancelled run leaves the previous index exactly as it was — a half-built index would be worse
than the one the user already had. The scan happens before the first boundary, so cancelling
during the scan of a very large folder is honoured once that scan finishes.

## Deleting

Deletion is a first-class feature, not an afterthought, and every write path has a tested
removal path:

- delete one folder's index — remove `indexes/<folderId>` and everything under it
  (`twigraph delete <folder-id>`);
- forget a folder — remove it from the config *and* delete its index, because an index
  nobody can reach is not worth keeping (`twigraph folder remove <folder-id>`);
- delete everything — remove what twigraph stored: the indexes, the config, any prepared model
  and the marker (`twigraph delete --all`);
- all three are idempotent: deleting something that is already gone succeeds.

Nothing twigraph wrote is left behind afterwards, and a test asserts exactly that by checking
the directory itself is gone rather than by trusting the code. That holds when twigraph's
artifacts were all there was: a directory still holding something twigraph did not create is
kept, with the user's file untouched.

### Proving the directory is twigraph's

The data directory can be pointed anywhere, so "delete everything" must never be able to
mean "delete whatever the user happened to point us at". `TWIGRAPH_DATA_DIR=~/Documents`
followed by `delete --all` would otherwise be a data-loss bug waiting for a typo.

Two independent mechanisms, because the operation is irreversible:

1. **A marker.** `.twigraph-data` is written the first time twigraph writes anything into the
   directory, and `delete --all` refuses outright unless it finds a valid one. A directory
   twigraph never wrote to is never touched, whatever it holds. Read paths never write the
   marker, so merely running `status` against a directory cannot take ownership of it.
2. **Named artifacts only.** Deletion removes `config.json`, `indexes/`, `models/` and the
   marker, then removes the directory with `rmdir`, which fails on a non-empty one. There
   is no recursive delete on a user-supplied path anywhere in that code path. A file the
   user put in the data directory for their own reasons survives, and the directory
   holding it survives with it.

The second mechanism is what keeps the first from being load-bearing: even a directory that
somehow carries a marker cannot lose anything twigraph did not itself create. Belt and braces,
on purpose — this is the one operation in the product that cannot be undone.

The marker is not a substitute for the user's judgement, and it is not a security boundary.
It is a check against twigraph's own mistakes, which is where the risk actually lives.

There is one residual ownership caveat: the first write marks its target directory even if
that directory was already non-empty. Deletion still touches only the four named artifact
paths, but a pre-existing entry named `indexes` or `models` would be indistinguishable from
one created by twigraph. Users must therefore dedicate `TWIGRAPH_DATA_DIR` to twigraph. A future
hardening step may refuse to claim a non-empty unmarked directory.

## Chunking

Chunking is deterministic and structure-aware.

- Tokens are estimated as `characters / 4`. No tokenizer runs at chunk time.
- Target size is `900` tokens, so roughly 3600 characters.
- Overlap is `12%` of the target, taken from the previous chunk's tail and cut at a
  sentence boundary so a sentence is never half-quoted in two chunks.
- A chunk never spans a heading boundary: a heading starts a new chunk, because the
  heading trail is the citation anchor and a chunk with two trails has none.
- A single block larger than the target is split at sentence boundaries.

Each `ChunkRecord` records its document id, ordinal, the page of its first block and
`pageEnd`, its heading trail, and `charStart`/`charEnd`.

`charStart` and `charEnd` are offsets into the document's flattened text — every block's
text joined with `\n\n`. `chunk.text` is exactly `documentText.slice(charStart, charEnd)`,
so a citation can always be reproduced from the chunk alone. Overlap is expressed as a
`charStart` that reaches back before the previous chunk's `charEnd`.

Chunk ids are `<documentId>:<ordinal>`, derived and stable.

## Retrieval

### Lexical

BM25 with `k1 = 1.2`, `b = 0.75`. It is the floor, not a fallback to be embarrassed
about: it is deterministic, needs no download, and is the only retriever that works with
no model present.

Tokenization: Unicode NFC normalisation, case folding, then a split on anything that is
not a letter or a digit. No stemming, no stop-word list — a stop-word list would make the
ranking depend on a language the user never declared.

Scores are normalised into `[0, 1]` by dividing by the theoretical maximum for the query,
`sum(idf) * (k1 + 1)`. The raw BM25 number is not comparable between queries; the
normalised one is, which is what makes `retrieval.minScore` a meaningful confidence gate.
A query whose terms barely appear scores near zero and is refused rather than answered.

### Semantic retrieval (planned)

No vector index or fusion implementation exists in the current vertical slice. When it is
added, a corpus without vectors must degrade to the BM25 order **through the same code
path**. Two code paths means two behaviours, and only one of them gets tested.

Rank lists are fused with Reciprocal Rank Fusion (`k = 60`), never by summing raw scores —
BM25 and cosine live on different scales.

Vector search is exact (brute force) for now. The memory cost is
`dimension * 4 bytes * chunk count`, documented rather than pretended away.

## Citations and the confidence gate

Search returns ranked, cited chunks and applies the configured minimum score. The `ask` path is
implemented: it ranks, applies the same gate, and only then asks the extractive engine for an
answer, so the gate runs **before** anything can produce text.

A citation is `{ marker, chunkId, filename, absolutePath, page?, pageEnd?, headingPath,
excerpt }`, derived from the chunk and never invented by a model.

The confidence gate is applied to search and to ask alike. A weak query is refused while
retaining the ranked-source context needed for inspection.

The shared grounding primitive already enforces that extractive passages are verbatim
substrings of retrieved chunks, and the extractive engine routes every answer through it. A
future model-generated answer would be validated differently: every `[n]` marker
must map to a chunk that was actually sent as context; invalid markers are dropped and
reported, never displayed as if they were real.

## Desktop app

`apps/desktop` is a second client over the same engine, not a second product. It parses nothing,
stores nothing and ranks nothing of its own: it builds the same `FolderRegistry` and `IndexStore`
the CLI does, resolves the data directory with the same `resolveDataDir`, and therefore reads an
index the CLI built. `TWIGRAPH_DATA_DIR` moves both at once, and a folder indexed at the command
line is searchable in the window without copying anything.

```
apps/desktop/src/main        service.ts (every channel), ipc.ts (the boundary), main.ts (Electron)
apps/desktop/src/preload     api.ts: the object contextBridge exposes as window.twigraph
apps/desktop/src/renderer    the page, and view-model.ts for everything it says
```

Four rules hold across the split:

1. **`service.ts` imports nothing from Electron.** The folder picker and the two shell calls
   arrive as parameters. That is what lets the whole desktop surface — every channel, every
   refusal, cancellation, and the refusal to open a file outside an index — be tested without
   launching a window.
2. **Exactly one place turns a throw into a value.** Handlers return `{ ok: true, value }` or
   `{ ok: false, error: WireError }`, so the renderer never sees a stack. `ipc.ts` also checks
   the shape of its arguments first, so a folder id that is not a string never reaches the
   registry.
3. **The renderer is not trusted with the machine.** It runs sandboxed, with context isolation on
   and no Node integration, and its page carries
   `default-src 'none'; script-src 'self'; connect-src 'none'`. The preload exposes the named
   channels and no generic `invoke`. `source:open` and `source:reveal` refuse any path that is
   not a document in an index the user built, because otherwise "the renderer has no filesystem"
   would be untrue: the shell could be asked to open anything.
4. **The channel set is a `Record` over `IpcChannel`.** Leaving one unimplemented is a compile
   error rather than a missing handler at runtime.

`index:start` resolves when the run ends, so a cancelled or failed run arrives as an `IpcFailure`
on the same call that started it, and the contract needs no fifth event. Progress and per-file
failures still arrive as events while it runs — a file the run could not read is named on
`index:error` rather than disappearing.

Three things are deliberately absent rather than faked:

- `ask:chunk` is never emitted, because the extractive engine does not stream;
- `model:prepare` is refused with `EMBEDDING_UNAVAILABLE`, and any provider other than
  `extractive` with `LLM_UNAVAILABLE`. `engine:status` reports both as unavailable, so the window
  says "not in this build" instead of showing a control that would do nothing;
- the IPC surface has no channel for deleting the whole data directory, so `delete --all` remains
  a CLI operation. Removing a folder removes its index with it, as it does in the CLI.

The window has no installer and is Windows-only for now. `npm run desktop` builds the three
bundles and starts it. The renderer must reach `shared` through the `@twigraph/shared/ipc` and
`@twigraph/shared/citations` subpaths: the package root pulls in `config.ts`, which uses
`node:fs`, and the page has no filesystem.

## Privacy

Three network modes, enforced by `tests/setup/no-network.ts`:

| mode | loopback | anything else |
| --- | --- | --- |
| `default` | allowed | refused |
| `ollama` | allowed on the configured ports only | refused |
| `offline` | refused | refused |

The only network path the product will have is the one-time download of a local embedding
model, and only after the user asks for it. No model means BM25, which needs nothing.

As it stands, **no code path in the product reaches the network at all** — there is no
embedding download yet, and the CLI's `TWIGRAPH_OFFLINE` flag is recorded and reported but has
nothing to refuse. Saying that plainly matters more than shipping a flag that looks like a
guarantee. The enforcement that backs the flag today is the test suite: `build.test.ts` and
`apps/cli/tests/cli.test.ts` both run a whole index-and-search inside `offline` mode and
assert that zero attempts were made *and* that the guard is live, by proving it refuses a
real request in the same run.

Logs carry paths, counts and error codes. They never carry chunk text, document content,
or anything a user would be unhappy to find in a log file. `toWireError()` drops anything
that is not a `TwigraphError`, because an arbitrary `Error.message` can contain a path or a
fragment of a document.

## Testing

- **TDD.** A failing test comes first, and it must fail for the right reason.
- **Never mock our own logic.** Only I/O boundaries and the embedding model are stubbed.
  Retrieval maths, chunking and citation mapping are tested for real.
- **Synthetic fixtures only.** `fixtures/generate.mjs` writes them; the generated directory
  is git-ignored. A real document never enters the repository, including in a test.
- **Coverage gates:** at least 90% of lines and 85% of branches.
- **No-network verification** runs the whole user-visible flow inside the guard and fails
  the build if anything reaches out.

### Current verified baseline

At the completion of the desktop vertical slice, `npm run verify` reports 32 test files plus 1
opt-in Electron smoke test file, 438 passing tests with 4 opt-in smoke tests skipped by default,
and coverage of 95.74% statements, 86.86% branches, 98.97% functions, and 96.66% lines. Branch
coverage is the closest to its 85% gate, so new branches must arrive with focused tests. These
values are a snapshot; the command output is authoritative after subsequent changes.
