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
