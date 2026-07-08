# Design — RAG Retrieval Infrastructure

**Date:** 2026-07-08
**Repo:** `SmartJobSearchCRM-BE` (backend-only)
**Part 1 of 2** — the reusable retrieval layer. Part 2 (AI résumé tailoring) consumes it and gets its own spec.

## Problem / Goal

Build a reusable **retrieval-augmented** layer over a user's uploaded documents:
embed their document text into vectors, store them in Postgres, and retrieve the
most relevant chunks for any query — scoped to the owning user. This is the
foundation the résumé-tailoring feature (and any future "ask your documents"
feature) grounds its generation on.

Nothing significant ships to end users in this part; the only user-facing surface
is a small search/reindex endpoint used for the demo and for tests.

## Context (what exists)

- **Documents module** (`src/modules/documents/`): uploaded files (PDF/DOC/DOCX/
  MD/TXT) stored behind a swappable `storage` interface; `Document` model with
  `storageKey`, `mimeType`, `userId`.
- **`extractText(buffer, mimeType)`** (`analysis/engine/extract.js`): already
  extracts flat text from PDF/DOCX/markdown/plain — reused here for chunking.
- **Provider routing** (`analysis/engine/openrouter.js`): `resolveProvider(spec)`
  maps a `<provider>:` prefix (e.g. `nvidia:`) to that provider's base URL + key.
  The embedding client reuses it.
- **DB:** PostgreSQL on Neon (supports the `pgvector` extension). Prisma.

## Verified facts (measured against the live NVIDIA endpoint)

- Embedding model **`nvidia/nv-embedqa-e5-v5`**: **1024-dimensional**, ~1s/call.
- It is an **asymmetric** model: the `/embeddings` call **requires `input_type`** —
  `"passage"` when embedding documents to index, `"query"` when embedding a search
  query. Omitting it returns HTTP 400. Both directions return 1024-dim vectors.
- `snowflake/arctic-embed-l` is not available on this account (404); nv-embedqa-e5-v5
  is the chosen model.

## Architecture

Five small, independently-testable units.

### 1. Storage — pgvector migration + `DocumentChunk`

A raw-SQL Prisma migration:
- `CREATE EXTENSION IF NOT EXISTS vector;`
- `DocumentChunk` table:
  - `id` (uuid/cuid PK)
  - `documentId` → FK to `Document`, `ON DELETE CASCADE`
  - `userId` (denormalized for query-time scoping without a join)
  - `chunkIndex` int
  - `content` text
  - `embedding vector(1024)`
  - `createdAt`
- HNSW index: `CREATE INDEX ... ON "DocumentChunk" USING hnsw (embedding vector_cosine_ops);`

Prisma cannot represent the `vector` type, so the column is declared
`embedding Unsupported("vector(1024)")` in `schema.prisma` (keeps Prisma in sync;
never selected through the typed client). All vector reads/writes use `$queryRaw`
/ `$executeRaw`. The rest of the row (ids, content, indices) uses normal Prisma
where convenient.

### 2. Embedding client — `analysis/engine/embeddings.js`

```
embed(texts: string[], inputType: 'passage' | 'query') => Promise<number[][]>
```
- Resolves the provider from `EMBEDDING_MODEL` (default `nvidia:nvidia/nv-embedqa-e5-v5`)
  via the existing `resolveProvider`, so base URL + key + the bare model id are
  reused from the routing layer.
- POSTs `{ model, input: texts, input_type: inputType }` to `<base>/embeddings`.
- Returns the array of 1024-dim vectors in input order.
- Throws a tagged error (same `OpenRouterError` shape / `kind`) on config/http/
  network/timeout failure. Single provider — no fallback in this part.
- Batches (array input) so a document's chunks embed in one call where size allows.

### 3. Chunking — `analysis/engine/chunk.js`

```
chunkText(text: string, opts?) => string[]
```
- Pure function. Splits on blank-line paragraph boundaries, packs paragraphs into
  chunks up to a target size (~500 chars), and splits any single oversized
  paragraph on sentence boundaries. Adds a small overlap (~1 sentence) between
  adjacent chunks so context isn't lost at the seam.
- No I/O, fully deterministic, unit-tested.

### 4. Indexing — `modules/rag/rag.service.js`

```
indexDocument(userId, documentId) => { chunks: number }
```
- Loads the `Document` (ownership-checked by `userId`), reads its bytes via the
  storage layer, runs `extractText`. If extraction fails/empty → index nothing,
  return `{ chunks: 0 }` (not an error — scanned PDFs simply aren't indexable).
- `chunkText` → `embed(chunks, 'passage')`.
- Replaces that document's chunks in ONE transaction: delete existing
  `DocumentChunk` rows for `documentId`, insert the new ones (content + vector).
  Idempotent — re-indexing a document is safe.
- **Trigger:** called from the documents upload flow **after** a successful
  upload, awaited but wrapped so an indexing failure is logged and never fails the
  upload (the file is still saved; it can be reindexed later).
- **Backfill:** `reindexAll(userId)` iterates the user's documents and indexes
  each; exposed via `POST /api/rag/reindex` for existing documents.
- Deletion: `Document` delete cascades to its chunks via the FK — no extra code.

### 5. Retrieval — `modules/rag/rag.service.js`

```
retrieve(userId, queryText, { topK = 6, documentIds? }) => { documentId, content, similarity }[]
```
- `embed([queryText], 'query')` → one 1024-dim query vector.
- pgvector cosine search via `$queryRaw`:
  `SELECT "documentId", content, 1 - (embedding <=> $vec) AS similarity
   FROM "DocumentChunk" WHERE "userId" = $userId [AND "documentId" = ANY($ids)]
   ORDER BY embedding <=> $vec LIMIT $topK`
- **Always** filters by `userId` (no cross-user leakage). Optional `documentIds`
  narrows to specific documents.
- The query vector is passed as a pgvector literal (`'[...]'::vector`) built from
  the embedding, parameterized.

### HTTP surface (minimal)

- `POST /api/rag/reindex` → `reindexAll(req.userId)` → `{ documents, chunks }`.
- `GET /api/rag/search?q=...&topK=` → `retrieve(...)` → the chunk list. For the
  demo and integration tests; the tailoring feature calls `retrieve()` in-process.
- Both `requireAuth`, `userId`-scoped. `rag.routes.js` + `rag.controller.js`
  mirror the existing module conventions.

## Data flow

```
Upload document → save bytes → indexDocument(userId, id)
   → extractText → chunkText → embed(passage) → replace DocumentChunk rows

Query (tailoring feature or /api/rag/search)
   → embed(query) → pgvector cosine search (userId-scoped) → top-K chunks
```

## Error handling

- Embedding provider down / no key → `indexDocument` logs + returns `{chunks:0}`
  (upload still succeeds); `retrieve` throws a tagged error the caller surfaces as
  a 503 "AI busy" (same pattern as cover-letter).
- Extraction failure (scanned PDF) → document simply has no chunks; retrieval just
  won't return it. No hard failure.
- All vector SQL is parameterized; `userId` filter is mandatory in every read.

## Testing

- **`chunk.js`** — pure unit tests: paragraph packing, oversized-paragraph
  sentence split, overlap, empty/whitespace input.
- **`embeddings.js`** — mock `fetch`: asserts the request carries `input_type`,
  the resolved model + NVIDIA base/key (via routing), array batching, and returns
  vectors in order; error tagging on non-2xx.
- **`rag.service` (integration)** — against the test Postgres, which **must run a
  pgvector-enabled image** (e.g. `pgvector/pgvector:pg16`); embeddings mocked to
  deterministic vectors so cosine ordering is asserted without a live model:
  index two documents, `retrieve` returns the nearer chunk first, and results are
  `userId`-scoped (a second user sees none). Reindex replaces (no duplicates).
- CI note: the Postgres **service image must include pgvector** — the one infra
  prerequisite of this part.

## Configuration

- New env `EMBEDDING_MODEL="nvidia:nvidia/nv-embedqa-e5-v5"` (documented in
  `.env.example`). Reuses the existing `NVIDIA_BASE_URL` / `NVIDIA_OPENAI_KEY`.
- **Deploy:** enable `pgvector` on Neon (the migration's `CREATE EXTENSION` does
  this if the role has rights; otherwise enable once in the Neon console), run
  `prisma migrate deploy`, then `POST /api/rag/reindex` per user (or a one-off
  backfill) to index existing documents.

## Non-goals / deferred (to part 2 or later)

- The résumé-tailoring generation itself (part 2).
- Cross-encoder reranking, hybrid keyword+vector search, chunk metadata filters.
- Re-embedding on document *content* change (documents are immutable uploads;
  re-upload + reindex covers it).
- Multi-provider embedding fallback.

## Known limits

- Scanned/image-only PDFs aren't indexable (no extractable text) — consistent with
  the rest of the app.
- Embedding on upload adds ~1–2s latency (graceful, non-blocking on failure).
- HNSW is approximate; at this corpus size recall is effectively exact.
