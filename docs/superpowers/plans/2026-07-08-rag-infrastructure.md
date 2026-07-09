# RAG Retrieval Infrastructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A reusable, `userId`-scoped retrieval layer over a user's uploaded documents — embed document text into pgvector, retrieve the most JD-relevant chunks for any query.

**Architecture:** Five small units — pure chunking, a NVIDIA embedding client (reusing the existing provider routing), a pgvector-backed `DocumentChunk` store, an indexing service (sync-on-upload + backfill), and cosine retrieval — plus a minimal `/api/rag` surface. Vector columns are raw-SQL (`Unsupported("vector(1024)")` in Prisma); everything else is normal Prisma.

**Tech Stack:** Node + Express + Prisma + PostgreSQL/pgvector (Neon) + Jest; NVIDIA NIM embeddings (`nv-embedqa-e5-v5`, 1024-dim) via the existing `resolveProvider` routing.

## Global Constraints

- **Embedding model:** `nvidia/nv-embedqa-e5-v5`, **1024-dim**, **asymmetric** — every embedding call MUST pass `input_type`: `"passage"` for indexed documents, `"query"` for searches. Omitting it is an HTTP 400.
- **Env:** `EMBEDDING_MODEL` default `"nvidia:nvidia/nv-embedqa-e5-v5"`, resolved through `resolveProvider` (reuses `NVIDIA_BASE_URL` / `NVIDIA_OPENAI_KEY`).
- **Every vector read filters by `userId`** — no cross-user leakage, ever.
- Reuse existing units: `resolveProvider` + `OpenRouterError` from `src/modules/analysis/engine/openrouter.js`; `extractText` from `src/modules/analysis/engine/extract.js`; `storage` from `src/shared/storage`.
- CommonJS, uuid PKs (`@default(uuid())`), follow existing module conventions (`x.service.js` / `x.controller.js` / `x.routes.js`, all `requireAuth` + `userId`-scoped).
- Tests: `npm test -- <file>` (Jest, per-worker Postgres schema). **The test/CI Postgres image MUST include pgvector** (Task 3 swaps it).
- Indexing is best-effort: an indexing failure NEVER fails a document upload.

## File Structure

- `src/modules/analysis/engine/chunk.js` (+ `chunk.test.js`) — pure `chunkText`.
- `src/modules/analysis/engine/embeddings.js` (+ `embeddings.test.js`) — `embed`, `embeddingConfigured`.
- `prisma/schema.prisma` — `DocumentChunk` model + `Document.chunks` back-relation.
- `prisma/migrations/<ts>_add_document_chunk/migration.sql` — extension + table + indexes + FK.
- `docker-compose.yml` — pgvector image.
- `src/modules/rag/rag.service.js` — `indexDocument`, `reindexAll`, `retrieve`.
- `src/modules/rag/rag.controller.js`, `src/modules/rag/rag.routes.js` — endpoints.
- `src/routes/index.js` — mount `/rag`.
- `src/modules/documents/documents.service.js` — index-on-upload hook.
- `.env.example` — `EMBEDDING_MODEL`.
- `tests/rag.test.js` — indexing + retrieval + endpoint integration.

---

### Task 1: Pure text chunking

**Files:**
- Create: `src/modules/analysis/engine/chunk.js`
- Test: `src/modules/analysis/engine/chunk.test.js`

**Interfaces:**
- Produces: `chunkText(text: string, opts?: { targetChars?: number, overlapSentences?: number }) => string[]`

- [ ] **Step 1: Write the failing test** — `chunk.test.js`:

```js
const { chunkText } = require('./chunk');

describe('chunkText', () => {
  test('short text returns a single chunk', () => {
    expect(chunkText('Just one short paragraph.')).toEqual(['Just one short paragraph.']);
  });
  test('empty / whitespace returns no chunks', () => {
    expect(chunkText('   \n\n ')).toEqual([]);
    expect(chunkText('')).toEqual([]);
  });
  test('packs paragraphs up to the target size across multiple chunks', () => {
    const p = 'x'.repeat(300);
    const chunks = chunkText(`${p}\n\n${p}\n\n${p}`, { targetChars: 400, overlapSentences: 0 });
    expect(chunks.length).toBe(3); // 300 each, target 400 -> one per chunk
    expect(chunks[0]).toContain('x');
  });
  test('splits an oversized single paragraph on sentence boundaries', () => {
    const para = 'Alpha sentence one. Beta sentence two. Gamma sentence three.';
    const chunks = chunkText(para, { targetChars: 25, overlapSentences: 0 });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join(' ')).toContain('Gamma sentence three.');
  });
  test('overlap seeds a chunk with the previous chunk final sentence', () => {
    const para = 'One. Two. Three. Four.';
    const chunks = chunkText(para, { targetChars: 10, overlapSentences: 1 });
    // each later chunk starts with the last sentence of the previous chunk
    expect(chunks[1].startsWith(chunks[0].trim().split(/(?<=[.!?])\s+/).slice(-1)[0])).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- chunk`
Expected: FAIL — `Cannot find module './chunk'`.

- [ ] **Step 3: Write minimal implementation** — `chunk.js`:

```js
// Pure text chunker for RAG indexing: packs paragraphs into ~targetChars chunks
// on natural boundaries, splitting any oversized paragraph on sentence ends, with
// an optional 1-sentence overlap so context isn't lost at a chunk seam. No I/O.
function splitSentences(s) {
  return (s.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g) || []).map((x) => x.trim()).filter(Boolean);
}

function chunkText(text, { targetChars = 500, overlapSentences = 1 } = {}) {
  const clean = String(text || '').replace(/\r\n/g, '\n').trim();
  if (!clean) return [];

  // Atomic units = paragraphs; an oversized paragraph is broken into sentence packs.
  const units = [];
  for (const para of clean.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)) {
    if (para.length <= targetChars) { units.push(para); continue; }
    let buf = '';
    for (const sent of splitSentences(para)) {
      if (buf && buf.length + 1 + sent.length > targetChars) { units.push(buf); buf = sent; }
      else buf = buf ? `${buf} ${sent}` : sent;
    }
    if (buf) units.push(buf);
  }

  // Pack units into chunks up to targetChars.
  const chunks = [];
  let buf = '';
  for (const u of units) {
    if (buf && buf.length + 2 + u.length > targetChars) { chunks.push(buf); buf = u; }
    else buf = buf ? `${buf}\n\n${u}` : u;
  }
  if (buf) chunks.push(buf);

  // Optional overlap: seed each chunk with the previous chunk's final sentence(s).
  if (overlapSentences > 0) {
    for (let i = 1; i < chunks.length; i += 1) {
      const tail = splitSentences(chunks[i - 1]).slice(-overlapSentences).join(' ');
      if (tail) chunks[i] = `${tail} ${chunks[i]}`;
    }
  }
  return chunks;
}

module.exports = { chunkText };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- chunk`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/analysis/engine/chunk.js src/modules/analysis/engine/chunk.test.js
git commit -m "feat(rag): pure text chunker for embedding indexing"
```

---

### Task 2: NVIDIA embedding client

**Files:**
- Create: `src/modules/analysis/engine/embeddings.js`
- Test: `src/modules/analysis/engine/embeddings.test.js`

**Interfaces:**
- Consumes: `resolveProvider`, `OpenRouterError` from `./openrouter`.
- Produces: `embed(texts: string[], inputType: 'passage'|'query') => Promise<number[][]>`; `embeddingConfigured() => boolean`.

- [ ] **Step 1: Write the failing test** — `embeddings.test.js`:

```js
const { embed, embeddingConfigured } = require('./embeddings');

beforeEach(() => {
  process.env.EMBEDDING_MODEL = 'nvidia:nvidia/nv-embedqa-e5-v5';
  process.env.NVIDIA_BASE_URL = 'https://nv.test/v1';
  process.env.NVIDIA_OPENAI_KEY = 'nv-key';
});
afterEach(() => {
  delete process.env.EMBEDDING_MODEL; delete process.env.NVIDIA_BASE_URL; delete process.env.NVIDIA_OPENAI_KEY;
  jest.restoreAllMocks();
});

test('embed posts input_type + resolved model/base/key and returns vectors in order', async () => {
  let captured;
  global.fetch = jest.fn().mockImplementation((url, opts) => {
    captured = { url, opts };
    return Promise.resolve({ ok: true, json: async () => ({ data: [{ embedding: [1, 2, 3] }, { embedding: [4, 5, 6] }] }) });
  });
  const vectors = await embed(['alpha', 'beta'], 'passage');
  expect(String(captured.url)).toBe('https://nv.test/v1/embeddings');
  expect(captured.opts.headers.Authorization).toBe('Bearer nv-key');
  const body = JSON.parse(captured.opts.body);
  expect(body.model).toBe('nvidia/nv-embedqa-e5-v5');
  expect(body.input_type).toBe('passage');
  expect(body.input).toEqual(['alpha', 'beta']);
  expect(vectors).toEqual([[1, 2, 3], [4, 5, 6]]);
});

test('rejects an invalid input_type without calling the network', async () => {
  global.fetch = jest.fn();
  await expect(embed(['x'], 'nope')).rejects.toMatchObject({ kind: 'config' });
  expect(global.fetch).not.toHaveBeenCalled();
});

test('empty input returns [] without a request', async () => {
  global.fetch = jest.fn();
  expect(await embed([], 'passage')).toEqual([]);
  expect(global.fetch).not.toHaveBeenCalled();
});

test('missing provider key → config error', async () => {
  delete process.env.NVIDIA_OPENAI_KEY;
  await expect(embed(['x'], 'query')).rejects.toMatchObject({ kind: 'config' });
});

test('non-2xx → http error tagged with status', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 503, text: async () => 'busy' });
  await expect(embed(['x'], 'query')).rejects.toMatchObject({ kind: 'http', status: 503 });
});

test('embeddingConfigured reflects whether the provider key is set', () => {
  expect(embeddingConfigured()).toBe(true);
  delete process.env.NVIDIA_OPENAI_KEY;
  expect(embeddingConfigured()).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- embeddings`
Expected: FAIL — `Cannot find module './embeddings'`.

- [ ] **Step 3: Write minimal implementation** — `embeddings.js`:

```js
const { resolveProvider, OpenRouterError } = require('./openrouter');

const DEFAULT_EMBEDDING_MODEL = 'nvidia:nvidia/nv-embedqa-e5-v5';
const EMBED_TIMEOUT_MS = 30000;

function embeddingSpec() { return process.env.EMBEDDING_MODEL || DEFAULT_EMBEDDING_MODEL; }

// True when the configured embedding provider has an API key — used to gate
// index-on-upload so environments without a key (e.g. tests) skip embedding.
function embeddingConfigured() { return Boolean(resolveProvider(embeddingSpec()).key); }

// Embed an array of texts. `inputType` is required by the asymmetric model:
// 'passage' for indexed content, 'query' for a search string. Returns one vector
// per input, in order. Throws a tagged OpenRouterError on any failure.
async function embed(texts, inputType) {
  if (inputType !== 'passage' && inputType !== 'query') {
    throw new OpenRouterError(`invalid input_type: ${inputType}`, 'config');
  }
  if (!Array.isArray(texts) || texts.length === 0) return [];
  const { model, baseUrl, key } = resolveProvider(embeddingSpec());
  if (!key) throw new OpenRouterError(`API key not configured for the embedding provider (${embeddingSpec()})`, 'config');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EMBED_TIMEOUT_MS);
  try {
    let res;
    try {
      res = await fetch(`${baseUrl}/embeddings`, {
        method: 'POST',
        signal: controller.signal,
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, input: texts, input_type: inputType }),
      });
    } catch (e) {
      if (e.name === 'AbortError') throw new OpenRouterError('embedding request timed out', 'timeout');
      throw new OpenRouterError(`embedding request failed: ${e.message}`, 'network', { cause: e });
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new OpenRouterError(`embedding request failed: ${res.status} ${body.slice(0, 200)}`, 'http', { status: res.status });
    }
    const data = await res.json();
    const vectors = (data && data.data ? data.data : []).map((d) => d.embedding);
    if (vectors.length !== texts.length) throw new OpenRouterError('embedding count mismatch', 'parse');
    return vectors;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { embed, embeddingConfigured };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- embeddings`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/analysis/engine/embeddings.js src/modules/analysis/engine/embeddings.test.js
git commit -m "feat(rag): NVIDIA embedding client (asymmetric input_type, provider routing)"
```

---

### Task 3: pgvector store — `DocumentChunk` model + migration + image

**Files:**
- Modify: `docker-compose.yml` (Postgres image)
- Modify: `prisma/schema.prisma` (add `DocumentChunk`, `Document.chunks` back-relation)
- Create: `prisma/migrations/<timestamp>_add_document_chunk/migration.sql`
- Test: `tests/rag.store.test.js`

**Interfaces:**
- Produces: table `DocumentChunk(id, documentId, userId, chunkIndex, content, embedding vector(1024), createdAt)` with an HNSW cosine index and a cascading FK to `Document`.

- [ ] **Step 1: Swap the Postgres image to pgvector** — in `docker-compose.yml` change the db service image:

```yaml
    image: pgvector/pgvector:pg16
```

Recreate the container so the extension is available:

```bash
docker compose up -d --force-recreate db
```

- [ ] **Step 2: Add the model to `schema.prisma`** — append the model and add the back-relation to `model Document` (after its `resumeAnalyses` line):

```prisma
model Document {
  // ...existing fields...
  resumeAnalyses   ResumeAnalysis[]
  chunks           DocumentChunk[]

  @@index([userId])
}

model DocumentChunk {
  id         String   @id @default(uuid())
  documentId String
  document   Document @relation(fields: [documentId], references: [id], onDelete: Cascade)
  userId     String
  chunkIndex Int
  content    String
  embedding  Unsupported("vector(1024)")
  createdAt  DateTime @default(now())

  @@index([userId])
  @@index([documentId])
}
```

- [ ] **Step 3: Generate the migration (create-only) and hand-edit the SQL**

Run: `npx prisma migrate dev --name add_document_chunk --create-only`

Then REPLACE the generated `prisma/migrations/<timestamp>_add_document_chunk/migration.sql` with (Prisma cannot emit the extension or the HNSW index for an `Unsupported` column — add them by hand; keep `CREATE EXTENSION` first so `vector(1024)` resolves):

```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE "DocumentChunk" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "embedding" vector(1024) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DocumentChunk_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DocumentChunk_userId_idx" ON "DocumentChunk"("userId");
CREATE INDEX "DocumentChunk_documentId_idx" ON "DocumentChunk"("documentId");
CREATE INDEX "DocumentChunk_embedding_idx" ON "DocumentChunk" USING hnsw ("embedding" vector_cosine_ops);

ALTER TABLE "DocumentChunk"
  ADD CONSTRAINT "DocumentChunk_documentId_fkey"
  FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

Apply it and regenerate the client:

```bash
npx prisma migrate dev
npx prisma generate
```

- [ ] **Step 4: Write a raw round-trip test** — `tests/rag.store.test.js` proves the extension, column, and cosine operator all work end-to-end:

```js
const { prisma, resetDb } = require('./helpers/db');
const { registerAndLogin } = require('./helpers/auth');

beforeEach(resetDb);
afterAll(async () => { await prisma.$disconnect(); });

const DIM = 1024;
const unit = (i) => { const a = new Array(DIM).fill(0); a[i] = 1; return `[${a.join(',')}]`; };

async function makeDoc(userId) {
  return prisma.document.create({
    data: { userId, name: 'r', type: 'Resume', originalFilename: 'r.txt', mimeType: 'text/plain', sizeBytes: 1, storageKey: `${userId}/r` },
  });
}

test('DocumentChunk stores 1024-dim vectors and cosine-orders them', async () => {
  const { user } = await registerAndLogin();
  const doc = await makeDoc(user.id);
  const rows = [[0, 'near text', unit(0)], [1, 'far text', unit(5)]];
  for (const [idx, content, vec] of rows) {
    await prisma.$executeRaw`INSERT INTO "DocumentChunk" ("id","documentId","userId","chunkIndex","content","embedding","createdAt")
      VALUES (${`c${idx}`}, ${doc.id}, ${user.id}, ${idx}, ${content}, ${vec}::vector, now())`;
  }
  const probe = unit(0);
  const result = await prisma.$queryRaw`
    SELECT content, 1 - (embedding <=> ${probe}::vector) AS similarity
    FROM "DocumentChunk" WHERE "userId" = ${user.id}
    ORDER BY embedding <=> ${probe}::vector LIMIT 2`;
  expect(result[0].content).toBe('near text');
  expect(Number(result[0].similarity)).toBeGreaterThan(Number(result[1].similarity));
});
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- rag.store`
Expected: PASS. (If it errors with `type "vector" does not exist`, the DB image/extension didn't apply — re-run Step 1 + `npx prisma migrate reset`.)

- [ ] **Step 6: Commit**

```bash
git add docker-compose.yml prisma/schema.prisma prisma/migrations tests/rag.store.test.js
git commit -m "feat(rag): DocumentChunk pgvector store + migration + pgvector test image"
```

---

### Task 4: Indexing service — `indexDocument` + `reindexAll`

**Files:**
- Create: `src/modules/rag/rag.service.js`
- Test: `tests/rag.test.js`

**Interfaces:**
- Consumes: `chunkText` (Task 1), `embed` (Task 2), `DocumentChunk` store (Task 3), `extractText` (`../analysis/engine/extract`), `storage` (`../../shared/storage`), `prisma`.
- Produces: `indexDocument(userId, documentId) => { chunks: number }`; `reindexAll(userId) => { documents: number, chunks: number }`.

- [ ] **Step 1: Write the failing test** — add to `tests/rag.test.js` (mock `embed` to deterministic unit vectors keyed off the text so no network is used):

```js
const fs = require('fs');
const os = require('os');
const path = require('path');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rag-it-'));
process.env.UPLOAD_DIR = tmpDir;

jest.mock('../src/modules/analysis/engine/embeddings', () => {
  const DIM = 1024;
  const unit = (i) => { const a = new Array(DIM).fill(0); a[Math.abs(i) % DIM] = 1; return a; };
  // deterministic: vector index = first char code of the text, so similar strings cluster
  return {
    embed: jest.fn(async (texts) => texts.map((t) => unit((t.trim().charCodeAt(0) || 0)))),
    embeddingConfigured: () => true,
  };
});

const { prisma, resetDb } = require('./helpers/db');
const { registerAndLogin } = require('./helpers/auth');
const rag = require('../src/modules/rag/rag.service');
const storage = require('../src/shared/storage');

beforeEach(resetDb);
afterAll(async () => { await prisma.$disconnect(); fs.rmSync(tmpDir, { recursive: true, force: true }); });

async function makeTextDoc(userId, text) {
  const storageKey = `${userId}/${Math.random().toString(36).slice(2)}.txt`;
  await storage.save(Buffer.from(text), storageKey);
  return prisma.document.create({
    data: { userId, name: 'r', type: 'Resume', originalFilename: 'r.txt', mimeType: 'text/plain', sizeBytes: text.length, storageKey },
  });
}

describe('indexDocument', () => {
  test('extracts, chunks, embeds and stores chunks; re-indexing replaces them', async () => {
    const { user } = await registerAndLogin();
    const doc = await makeTextDoc(user.id, 'Backend engineer with Node.js and PostgreSQL and Docker experience across many teams.');
    const first = await rag.indexDocument(user.id, doc.id);
    expect(first.chunks).toBeGreaterThan(0);
    const count1 = await prisma.documentChunk.count({ where: { documentId: doc.id } });
    expect(count1).toBe(first.chunks);
    // re-index replaces, not appends
    const second = await rag.indexDocument(user.id, doc.id);
    const count2 = await prisma.documentChunk.count({ where: { documentId: doc.id } });
    expect(count2).toBe(second.chunks);
  });

  test('an unextractable document indexes zero chunks without throwing', async () => {
    const { user } = await registerAndLogin();
    const doc = await makeTextDoc(user.id, 'x'); // < MIN_CHARS -> extractText ok:false
    const r = await rag.indexDocument(user.id, doc.id);
    expect(r.chunks).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- rag.test`
Expected: FAIL — `Cannot find module '../src/modules/rag/rag.service'`.

- [ ] **Step 3: Write minimal implementation** — `src/modules/rag/rag.service.js`:

```js
const prisma = require('../../shared/database/prisma');
const crypto = require('crypto');
const storage = require('../../shared/storage');
const { extractText } = require('../analysis/engine/extract');
const { chunkText } = require('../analysis/engine/chunk');
const { embed } = require('../analysis/engine/embeddings');

function readBuffer(key) {
  return new Promise((resolve, reject) => {
    const parts = [];
    storage.createReadStream(key).on('data', (d) => parts.push(d)).on('end', () => resolve(Buffer.concat(parts))).on('error', reject);
  });
}

const vecLiteral = (arr) => `[${arr.join(',')}]`;

// Index one document: extract -> chunk -> embed(passage) -> replace its chunks in
// one transaction. Idempotent. Returns how many chunks were stored (0 if the
// document has no extractable text).
async function indexDocument(userId, documentId) {
  const doc = await prisma.document.findFirst({ where: { id: documentId, userId } });
  if (!doc) return { chunks: 0 };
  const buffer = await readBuffer(doc.storageKey);
  const { text, ok } = await extractText(buffer, doc.mimeType);
  const chunks = ok ? chunkText(text) : [];
  const vectors = chunks.length ? await embed(chunks, 'passage') : [];

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`DELETE FROM "DocumentChunk" WHERE "documentId" = ${documentId}`;
    for (let i = 0; i < chunks.length; i += 1) {
      // pgvector lives in `public`; qualify the cast — `public` is not on the
      // per-worker test schema search_path (see Task 3).
      await tx.$executeRaw`INSERT INTO "DocumentChunk" ("id","documentId","userId","chunkIndex","content","embedding","createdAt")
        VALUES (${crypto.randomUUID()}, ${documentId}, ${userId}, ${i}, ${chunks[i]}, ${vecLiteral(vectors[i])}::public.vector, now())`;
    }
  });
  return { chunks: chunks.length };
}

async function reindexAll(userId) {
  const docs = await prisma.document.findMany({ where: { userId }, select: { id: true } });
  let chunks = 0;
  for (const d of docs) { chunks += (await indexDocument(userId, d.id)).chunks; } // eslint-disable-line no-await-in-loop
  return { documents: docs.length, chunks };
}

module.exports = { indexDocument, reindexAll };
```


- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- rag.test`
Expected: PASS (both `indexDocument` tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/rag/rag.service.js tests/rag.test.js
git commit -m "feat(rag): indexDocument + reindexAll (extract, chunk, embed, store)"
```

---

### Task 5: Retrieval — `retrieve`

**Files:**
- Modify: `src/modules/rag/rag.service.js` (add `retrieve`, export it)
- Test: `tests/rag.test.js` (add a describe block)

**Interfaces:**
- Consumes: `embed` (Task 2), the store (Task 3), `indexDocument` (Task 4).
- Produces: `retrieve(userId, queryText, opts?: { topK?: number, documentIds?: string[] }) => Promise<{ documentId, content, similarity }[]>`

- [ ] **Step 1: Write the failing test** — append to `tests/rag.test.js`:

```js
const ragRetrieve = require('../src/modules/rag/rag.service');

describe('retrieve', () => {
  test('returns the nearest chunk first and never crosses users', async () => {
    const { user } = await registerAndLogin();
    const other = await registerAndLogin();
    // 'N...' node doc vs 'G...' gardening doc — mock embeds by first char, so a
    // query starting with 'N' is nearest the node doc.
    const nodeDoc = await makeTextDoc(user.id, 'Node backend APIs with PostgreSQL.');
    const gardenDoc = await makeTextDoc(user.id, 'Gardening tips for tomatoes.');
    await ragRetrieve.indexDocument(user.id, nodeDoc.id);
    await ragRetrieve.indexDocument(user.id, gardenDoc.id);
    await ragRetrieve.indexDocument(other.user.id, (await makeTextDoc(other.user.id, 'Nutrition and diet plans.')).id);

    const hits = await ragRetrieve.retrieve(user.id, 'Need a Node engineer', { topK: 5 });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].documentId).toBe(nodeDoc.id);
    // strictly scoped: only this user's chunks appear
    const ids = new Set(hits.map((h) => h.documentId));
    expect(ids.has(gardenDoc.id) || ids.has(nodeDoc.id)).toBe(true);
    for (const h of hits) {
      const owned = await prisma.documentChunk.findFirst({ where: { documentId: h.documentId, userId: user.id } });
      expect(owned).not.toBeNull();
    }
  });

  test('documentIds narrows the search to specific documents', async () => {
    const { user } = await registerAndLogin();
    const a = await makeTextDoc(user.id, 'Alpha node service.');
    const b = await makeTextDoc(user.id, 'Bravo node service.');
    await ragRetrieve.indexDocument(user.id, a.id);
    await ragRetrieve.indexDocument(user.id, b.id);
    const hits = await ragRetrieve.retrieve(user.id, 'node', { topK: 5, documentIds: [b.id] });
    expect(hits.every((h) => h.documentId === b.id)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- rag.test`
Expected: FAIL — `ragRetrieve.retrieve is not a function`.

- [ ] **Step 3: Write minimal implementation** — add to `rag.service.js` and export:

```js
const { Prisma } = require('@prisma/client');

// Retrieve the top-K chunks most similar to queryText for this user (cosine).
// Always userId-scoped; optional documentIds narrows to specific documents.
async function retrieve(userId, queryText, { topK = 6, documentIds } = {}) {
  const [qvec] = await embed([queryText], 'query');
  const q = vecLiteral(qvec);
  const filter = documentIds && documentIds.length
    ? Prisma.sql`AND "documentId" = ANY(${documentIds})`
    : Prisma.empty;
  // Qualify the cast + distance operator — pgvector is in `public`, which is not
  // on the per-worker test schema search_path (see Task 3).
  return prisma.$queryRaw`
    SELECT "documentId", content, 1 - (embedding OPERATOR(public.<=>) ${q}::public.vector) AS similarity
    FROM "DocumentChunk"
    WHERE "userId" = ${userId} ${filter}
    ORDER BY embedding OPERATOR(public.<=>) ${q}::public.vector
    LIMIT ${topK}`;
}

module.exports = { indexDocument, reindexAll, retrieve };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- rag.test`
Expected: PASS (all indexing + retrieval tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/rag/rag.service.js tests/rag.test.js
git commit -m "feat(rag): userId-scoped cosine retrieve (optional documentIds filter)"
```

---

### Task 6: HTTP surface + index-on-upload hook + env

**Files:**
- Create: `src/modules/rag/rag.controller.js`, `src/modules/rag/rag.routes.js`
- Modify: `src/routes/index.js` (mount `/rag`)
- Modify: `src/modules/documents/documents.service.js` (index-on-upload hook)
- Modify: `.env.example` (`EMBEDDING_MODEL`)
- Test: `tests/rag.test.js` (endpoint + upload-hook block)

**Interfaces:**
- Consumes: `reindexAll`, `retrieve` (Tasks 4–5); `indexDocument` from the documents upload flow; `embeddingConfigured` (Task 2).
- Produces: `POST /api/rag/reindex → { documents, chunks }`; `GET /api/rag/search?q=&topK= → { hits }`.

- [ ] **Step 1: Write the failing test** — append to `tests/rag.test.js`:

```js
const { agent } = require('./helpers/testApp');
const auth = (t) => ({ Authorization: `Bearer ${t}` });

describe('rag endpoints', () => {
  test('POST /api/rag/reindex indexes the user documents; GET /api/rag/search returns hits', async () => {
    const { user, token } = await registerAndLogin();
    await makeTextDoc(user.id, 'Senior Node.js backend engineer, PostgreSQL, Docker, CI/CD.');
    const re = await agent().post('/api/rag/reindex').set(auth(token));
    expect(re.status).toBe(200);
    expect(re.body.chunks).toBeGreaterThan(0);
    const search = await agent().get('/api/rag/search').query({ q: 'node backend' }).set(auth(token));
    expect(search.status).toBe(200);
    expect(Array.isArray(search.body.hits)).toBe(true);
    expect(search.body.hits.length).toBeGreaterThan(0);
  });

  test('search requires authentication', async () => {
    const res = await agent().get('/api/rag/search').query({ q: 'x' });
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- rag.test`
Expected: FAIL — 404 on `/api/rag/reindex` (routes not mounted).

- [ ] **Step 3: Write the controller, routes, mount, and hook**

`src/modules/rag/rag.controller.js`:

```js
const service = require('./rag.service');

async function reindex(req, res, next) {
  try { res.status(200).json(await service.reindexAll(req.userId)); } catch (e) { next(e); }
}

async function search(req, res, next) {
  try {
    const q = String(req.query.q || '').trim();
    if (!q) return res.status(400).json({ error: 'q is required' });
    const topK = Math.min(20, Math.max(1, Number(req.query.topK) || 6));
    const hits = await service.retrieve(req.userId, q, { topK });
    return res.status(200).json({ hits });
  } catch (e) { return next(e); }
}

module.exports = { reindex, search };
```

`src/modules/rag/rag.routes.js`:

```js
const express = require('express');
const { requireAuth } = require('../../shared/middleware/auth');
const ctrl = require('./rag.controller');

const router = express.Router();
router.use(requireAuth);
router.post('/reindex', ctrl.reindex);
router.get('/search', ctrl.search);

module.exports = router;
```

Mount in `src/routes/index.js` (add the require near the other module requires and the `router.use` near the others):

```js
const ragRoutes = require('../modules/rag/rag.routes');
// ...
router.use('/rag', ragRoutes);
```

Index-on-upload hook in `src/modules/documents/documents.service.js` — after the document is created in `create()`, before returning it, add a best-effort index that never fails the upload and is skipped when embedding isn't configured:

```js
const { indexDocument } = require('../rag/rag.service');
const { embeddingConfigured } = require('../analysis/engine/embeddings');
// ...inside create(), replace `return doc;` with:
  if (embeddingConfigured()) {
    indexDocument(userId, doc.id).catch((err) => console.warn(`[rag] index-on-upload failed for ${doc.id}: ${err.message}`));
  }
  return doc;
```

**Note:** the hook is fire-and-forget (not awaited) so upload latency is unaffected; the endpoint test above indexes via `POST /reindex` (awaited) to avoid a race. (The spec's "awaited but non-blocking-on-failure" is realized here as fire-and-forget with a logged catch — either satisfies "never fails the upload"; fire-and-forget also keeps upload latency flat.)

- [ ] **Step 4: Add `EMBEDDING_MODEL` to `.env.example`** — under the AI section:

```bash
# RAG embeddings (NVIDIA NIM). Uses the provider routing + NVIDIA_* creds above.
EMBEDDING_MODEL="nvidia:nvidia/nv-embedqa-e5-v5"
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- rag.test`
Expected: PASS (endpoints + auth). Then the full suite serially:
Run: `npx jest --runInBand`
Expected: all green (existing documents tests unaffected — the upload hook is a no-op without an embedding key in the test env).

- [ ] **Step 6: Commit**

```bash
git add src/modules/rag/rag.controller.js src/modules/rag/rag.routes.js src/routes/index.js src/modules/documents/documents.service.js .env.example tests/rag.test.js
git commit -m "feat(rag): /api/rag reindex+search endpoints + index-on-upload hook"
```

---

## Self-Review notes (spec coverage)

- Storage / pgvector + `DocumentChunk` + HNSW + FK cascade → Task 3.
- Embedding client (asymmetric `input_type`, routing) → Task 2.
- Chunking (pure) → Task 1.
- Indexing (sync-on-upload + backfill, graceful, idempotent) → Tasks 4 + 6.
- Retrieval (userId-scoped cosine, optional documentIds) → Task 5.
- HTTP surface (`/reindex`, `/search`) → Task 6.
- `userId` filter on every vector read → Tasks 3 (test), 5 (impl).
- Config `EMBEDDING_MODEL` + deploy notes (pgvector image, Neon extension, reindex) → Tasks 3, 6.
- Test Postgres uses pgvector image → Task 3, Step 1.
