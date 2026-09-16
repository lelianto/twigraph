<div align="center">
  <img src="assets/mulat-logo.png" alt="mulat logo" width="168" />

  # mulat

  **Ask your files. Keep your files.**

  A privacy-first, local-first RAG engine for answers grounded in your own documents.
</div>

---

## Why mulat?

Your private documents should not have to leave your computer before they become useful.
mulat is being built to index folders you choose, retrieve the most relevant passages,
and answer with citations that lead back to the source.

The project is guided by three promises:

- **Local by default.** Documents, indexes, and retrieval stay on the device.
- **Grounded or silent.** An answer must be supported by retrieved text; uncertainty is a
  valid result.
- **Private by design.** No account, cloud database, or telemetry is required.

## Project status

> [!IMPORTANT]
> mulat is an early CLI preview, not yet an end-user desktop application.

A first vertical slice is in place: a local folder can be indexed and searched from the
command line, end to end. Implemented today:

- typed contracts for documents, answers, providers, and stores;
- citation mapping and grounded-answer validation;
- deterministic configuration and folder handling;
- network guards for offline and local-provider modes;
- folder scanning with ignore rules, content hashing, and a bounded read size;
- `.txt` and `.md` parsers behind a registry, which report a problem rather than crash;
- deterministic chunking that records a heading trail and a page range, and never crosses
  a heading boundary;
- an atomic on-disk index, built in a staging directory and swapped in, with a complete
  and tested deletion path;
- BM25 retrieval with citations, and a confidence gate that refuses a weak query;
- a CLI covering folders, indexing, search, status, privacy, and deletion;
- automated tests with enforced coverage thresholds.

Still on the roadmap, and deliberately not claimed yet:

- `ask`, the extractive answer path that turns ranked sources into a grounded answer;
- `.html`, `.docx`, and `.pdf` parsers;
- local embeddings, hybrid retrieval, and the optional local language model;
- incremental re-indexing: every run currently re-reads the whole folder;
- the desktop interface.

Keeping that distinction explicit is part of the project's commitment to source-grounded
claims—including claims about itself.

## Design principles

| Principle | What it means in practice |
| --- | --- |
| Local-first | Core search remains useful without a network connection. |
| Evidence-first | Citations come from retrieved chunks, never from model invention. |
| Deterministic | Identical inputs produce identical artifacts and ordering. |
| Deletable | Every persisted index must have a complete, tested removal path. |
| Small steps | The architecture grows through independently verified vertical slices. |

## Architecture direction

```text
chosen folders
      │
      ▼
document parsers ──► structured blocks ──► chunks
                                              │
                              ┌───────────────┴───────────────┐
                              ▼                               ▼
                         BM25 index              local embeddings (planned)
                              └───────────────┬───────────────┘
                                              ▼
                                      ranked retrieval
                                              │
                                              ▼
                                grounded answer + citations
```

BM25 is the offline baseline. Local embeddings will be optional, and any future language
model integration must sit behind the same grounding and citation checks.

## Try it

Requires Node.js 22.13 or newer. These commands use a synthetic folder, so you can try
mulat without pointing it at anything of your own.

```bash
npm install --include=dev
npm run fixture:generate          # writes a synthetic folder to fixtures/sample/
npm run mulat -- folder add fixtures/sample
npm run mulat -- index --all      # progress goes to stderr, one line per document
npm run mulat -- search "reciprocal rank fusion"
```

```text
1 result for "reciprocal rank fusion" (lexical, 7 ms)
  0.80  retrieval.md — § Retrieval › Fusion
        Rank lists are combined with reciprocal rank fusion: each retriever contributes
        1 / (k + rank); k is 60; raw scores are never added together.
```

```bash
npm run mulat -- status                       # what is indexed, and how much room it takes
npm run mulat -- search "atomic writes" --json
npm run mulat -- privacy                      # where your data is, and what can be reached
npm run mulat -- delete --all                 # remove everything mulat has stored
```

`delete --all` removes only mulat's named artifacts: `config.json`, `indexes/`, `models/`,
and its marker file. It removes the data directory itself only when nothing else remains,
and refuses an unmarked directory. The marker is created on the first write, however, so
do not deliberately point `MULAT_DATA_DIR` at a non-empty personal directory: existing
entries named `indexes` or `models` would then be treated as mulat artifacts.

Every command accepts `--data-dir <path>`, or `MULAT_DATA_DIR` in the environment. Without
either, mulat uses the place your platform expects application data to live:
`%LOCALAPPDATA%\mulat` on Windows, `~/Library/Application Support/mulat` on macOS, and
`~/.local/share/mulat` on Linux.

`npm run mulat` is a development convenience that runs the CLI from source. A packaged
binary is planned alongside the desktop application.

**No command in this build makes a network request at all.** The test suite installs a
guard that fails the run if one tries, and asserts that a full add-index-search-delete
cycle leaves zero attempts behind. `MULAT_OFFLINE=1` is recorded and reported, and will be
the flag that refuses the optional embedding download once that exists.

## Verification snapshot

The current vertical slice was last verified with:

- 21 test files;
- 311 passing tests and 3 opt-in smoke tests skipped by default;
- 94.79% statement, 85.97% branch, 97.76% function, and 95.89% line coverage;
- a real synthetic-fixture run through add, index, search, status, privacy, and deletion.

These numbers are a development snapshot, not a compatibility guarantee. `npm run verify`
is the source of truth for the checkout you are working with.

## Development

### Requirements

- Node.js 22.13 or newer
- npm

### Get started

```bash
git clone https://github.com/lelianto/mulat.git
cd mulat
npm install --include=dev
npm run verify
```

> [!NOTE]
> If your shell sets `NODE_ENV=production`, npm omits dev dependencies and you end up with
> no test runner and no type checker. `--include=dev` overrides that.

Useful commands:

| Command | Purpose |
| --- | --- |
| `npm run verify` | Run type checking, linting, and the coverage-gated test suite. |
| `npm run test:watch` | Run the fast TDD feedback loop. |
| `npm run mulat -- <args>` | Run the CLI from source, e.g. `npm run mulat -- status`. |
| `npm run fixture:generate` | Rewrite the synthetic fixtures under `fixtures/sample/`. |
| `npm run format:check` | Check repository formatting without modifying files. |
| `npm run format` | Format the repository with Prettier. |

## Repository layout

```text
packages/shared/              Contracts, configuration, citations, and grounding
packages/document-ingestion/  Folder scanning and the .txt and .md parsers
packages/indexing/            Deterministic chunking and the on-disk index
packages/retrieval/           BM25 ranking and search results
apps/cli/                     The command line interface
docs/                         Architecture notes
fixtures/                     The synthetic fixture generator
tests/setup/                  Determinism and no-network safeguards
tests/smoke/                  Cross-cutting behavior checks
assets/                       Project branding
```

## Contributing

The project follows strict test-first development. Read [`AGENTS.md`](AGENTS.md) before
changing production code; it documents the privacy, determinism, testing, and fixture
rules that keep mulat honest. [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) records the
current storage formats, package boundaries, and explicitly planned components.

## License

Licensed under the [Apache License 2.0](LICENSE).
