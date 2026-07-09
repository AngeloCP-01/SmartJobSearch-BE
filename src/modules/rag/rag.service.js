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
