const prisma = require('../../shared/database/prisma');
const crypto = require('crypto');
const { Prisma } = require('@prisma/client');
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

// Retrieve the top-K chunks most similar to queryText for this user (cosine).
// Always userId-scoped; optional documentIds narrows to specific documents.
async function retrieve(userId, queryText, { topK = 6, documentIds } = {}) {
  // The embedding model caps input at 512 tokens; a long query (e.g. a full job
  // description) exceeds it. Chunk the query with the same char bound used for
  // indexed passages (overlap off — pointless for a query) and mean-pool the
  // chunk vectors into one query vector. Chunks are <= targetChars and tokens
  // <= chars, so no embed input can exceed the model limit.
  const parts = chunkText(queryText, { overlapSentences: 0 });
  if (!parts.length) return [];
  const vecs = await embed(parts, 'query');
  const dim = vecs[0].length;
  const qvec = vecs.length === 1
    ? vecs[0]
    : Array.from({ length: dim }, (_, i) => vecs.reduce((sum, v) => sum + v[i], 0) / vecs.length);
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
