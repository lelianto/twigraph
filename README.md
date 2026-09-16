# mulat

**Ask deep questions about your own files without uploading them to the cloud.**

mulat is a local-first, privacy-first search assistant for your laptop. It indexes the
folders you choose and answers questions using only those documents, with a citation for
every claim. By default, your files never leave your device.

> Status: early MVP. All indexing, search and answering happens locally. Full documentation
> lands with the first release — see `docs/ARCHITECTURE.md`, `THREAT_MODEL.md` and
> `CONTRIBUTING.md` for what exists today.

## Privacy in one paragraph

There is no account, no cloud database, and no telemetry. The only network request the
application can make is the one-time download of the local embedding model, and only when
you explicitly ask for it. If you never prepare a model, mulat still works: it falls back
to BM25 lexical retrieval. Set `MULAT_OFFLINE=1` and every network path is disabled,
loopback included. The test suite enforces all of this rather than trusting it.

## Supported file types

| Format | Text | Page numbers | Headings |
| --- | --- | --- | --- |
| `.pdf` | text-layer PDFs only (no OCR) | yes | best effort |
| `.docx` | yes | — | yes |
| `.txt` | yes | — | — |
| `.md` | yes | — | yes |
| `.html` | yes | — | yes |

## Development

```bash
npm install
npm run verify                # typecheck + lint + tests with coverage gates
npm run test:watch            # TDD inner loop
```

See `CONTRIBUTING.md` for the workflow, and `AGENTS.md` for the rules this repository runs on.
