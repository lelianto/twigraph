---
name: local-rag
description: Technical rules for mulat's local RAG pipeline — document parsing, chunking, local embeddings, retrieval, citation tracking, local storage, privacy, and no-network verification. Use when touching packages/document-ingestion, packages/indexing, packages/retrieval, packages/providers, or apps/cli, or when adding a parser, a retrieval strategy, an embedding model, or a language-model provider.
---

# mulat local RAG pipeline

Every rule here exists to protect one of two promises: **the user's files stay on the
device**, and **an answer is only ever made of retrieved text**.

## The one shape everything speaks

Parsers emit `Block`s. Chunking, citations and the UI all work on `Block`s, never on a
format-specific structure. If you are about to add a field that only one parser can fill,
pass it through the block's `attributes` instead of widening the core shape.

```ts
Block = { kind: 'heading' | 'paragraph' | 'list' | 'table' | 'code'; level?; text; page? }
```

## Document parsing

- One parser per format, each behind the `DocumentParser` interface. Register it in the
  registry; never branch on a file extension at a call site.
- Record the citation anchor at parse time, because it cannot be reconstructed later:
  - PDF → the page the text came from (`pageNumber`);
  - Markdown / HTML / DOCX → the heading trail (`headingPath`).
- A parser never throws out of the pipeline. It returns either blocks or a typed
  `ParseError`; the indexer records the error against that one file and carries on.
- Empty file, no extractable text (a scanned PDF), corrupted container: each is a
  *reported* outcome, not a crash, and each has a test.
- Strip presentation markup from the text you embed, but keep code blocks and tables —
  they carry meaning.

## Chunking

- Structure first: never split through a heading boundary when you can start a new chunk
  there instead.
- Target ~900 tokens (estimate as `chars / 4`), overlap ~12% taken from the previous
  chunk's tail **at a sentence boundary**.
- Every chunk records: its document id, ordinal, the page of its first block and
  `pageEnd`, and its heading trail.
- Deterministic: identical input must produce byte-identical chunks. No `Date.now()`, no
  `Math.random()`, no locale-sensitive sorting.

## Embeddings

- `EmbeddingProvider` is lazy. The ONNX runtime is imported dynamically, so a user who
  never prepares a model never loads ~200 MB of native code.
- Normalize vectors to unit length at write time. Then cosine similarity is a dot product
  and search stays a tight loop.
- Keep the model id and dtype in `vectors.meta.json`. Vectors from a different model are
  not comparable — validate on read and force a re-index instead of returning garbage.
- Batching: embed in fixed-size batches and report progress; never build one giant array.

## Retrieval

- BM25 is the floor, not a fallback to be embarrassed about: it is deterministic, needs no
  download, and is the only retriever that works offline. Keep `k1 = 1.2`, `b = 0.75`.
- Fuse rank lists with Reciprocal Rank Fusion (`k = 60`). Do not fuse raw scores — BM25 and
  cosine live on different scales.
- When no vectors exist, RRF must degrade to the BM25 order **through the same code path**.
  Two code paths means two behaviours, and only one of them gets tested.
- Vector search is exact (brute force) for now. Document the memory cost
  (`dim × 4 bytes` per chunk) rather than pretending it is free.

## Citation tracking

- A citation is `{ filename, page?, headingPath, excerpt, chunkId }`. It is derived from the
  chunk, never invented by the model.
- The confidence gate runs **before** any language model is called. Weak retrieval returns
  `No reliable answer found.` plus the ranked sources — never an invitation to guess.
- Extractive answers must be a **verbatim substring** of a retrieved chunk.
  `assertGrounded()` enforces this and every answer path goes through it.
- With an LLM, the context blocks are numbered, the model must cite `[n]`, and every marker
  is validated against the retrieved chunks afterwards. Invalid markers are stripped and
  reported, never displayed as if they were real.
- Never paraphrase into a statement the sources do not support. "I don't know" is a
  correct answer.

## Local storage

- Everything lives under one user-visible directory. The user can see it, and can delete a
  folder's index or all of it from the UI.
- Writes are atomic: write `*.tmp`, then `fs.rename`. A torn write must leave the previous
  index usable, and there is a test for exactly that.
- Re-index builds a staging directory and swaps it in. Never mutate a live index in place.
- Deduplicate by content hash: embed identical content once, but keep a document record per
  folder so citations point at the file the user actually picked.
- Unchanged files (same size, mtime, hash) are skipped on re-index. Embedding work is the
  most expensive thing this application does.

## Privacy testing

- Install `tests/setup/no-network.ts` and assert on `guard.blocked()`. The three modes are
  `default` (loopback allowed), `ollama` (loopback on the configured port only) and
  `offline` (nothing at all).
- Every new network-touching code path needs a test proving it is refused in `offline` mode.
- Log paths, counts and error codes. **Never** log file contents, chunk text, or anything a
  user would be unhappy to see in a log file.
- Fixtures are synthetic and generated by `fixtures/generate.mjs`. A real document never
  enters the repository, including in a test.

## No-network verification

Run the full pipeline inside the guard, not just the function you just wrote:

```ts
const guard = installNetworkGuard({ mode: 'offline' })
try {
  await index(folder)
  await search('query')
  await ask('query')
  expect(guard.blocked()).toEqual([])
} finally {
  guard.restore()
}
```

A green unit test on an isolated function proves nothing about the promise. The guard is
installed around the whole user-visible flow, and it fails the build if anything reaches out.
