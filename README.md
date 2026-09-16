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
> mulat is an early-stage foundation, not yet an end-user application.

The repository currently contains the shared contracts and safety primitives that the
future ingestion, indexing, retrieval, and application layers will build on. Implemented
today:

- typed contracts for documents, answers, providers, and stores;
- citation mapping and grounded-answer validation;
- deterministic configuration and folder handling;
- network guards for offline and local-provider modes;
- automated tests with enforced coverage thresholds.

Document parsers, search indexes, embedding support, a CLI, and a desktop interface remain
on the roadmap. Keeping that distinction explicit is part of the project's commitment to
source-grounded claims—including claims about itself.

## Design principles

| Principle | What it means in practice |
| --- | --- |
| Local-first | Core search remains useful without a network connection. |
| Evidence-first | Citations come from retrieved chunks, never from model invention. |
| Deterministic | Identical inputs produce identical artifacts and ordering. |
| Deletable | Every persisted index must have a complete, tested removal path. |
| Incremental | The architecture grows through small, independently verified packages. |

## Architecture direction

```text
chosen folders
      │
      ▼
document parsers ──► structured blocks ──► chunks
                                              │
                              ┌───────────────┴───────────────┐
                              ▼                               ▼
                         BM25 index                    local embeddings
                              └───────────────┬───────────────┘
                                              ▼
                                      ranked retrieval
                                              │
                                              ▼
                                grounded answer + citations
```

BM25 is the offline baseline. Local embeddings will be optional, and any future language
model integration must sit behind the same grounding and citation checks.

## Development

### Requirements

- Node.js 22.13 or newer
- npm

### Get started

```bash
git clone https://github.com/lelianto/mulat.git
cd mulat
npm install
npm run verify
```

Useful commands:

| Command | Purpose |
| --- | --- |
| `npm run verify` | Run type checking, linting, and the coverage-gated test suite. |
| `npm run test:watch` | Run the fast TDD feedback loop. |
| `npm run format:check` | Check repository formatting without modifying files. |
| `npm run format` | Format the repository with Prettier. |

## Repository layout

```text
packages/shared/   Shared contracts, configuration, citations, and grounding
tests/setup/       Determinism and no-network safeguards
tests/smoke/       Cross-cutting behavior checks
assets/            Project branding
```

## Contributing

The project follows strict test-first development. Read [`AGENTS.md`](AGENTS.md) before
changing production code; it documents the privacy, determinism, testing, and fixture
rules that keep mulat honest.

## License

Licensed under the [Apache License 2.0](LICENSE).
