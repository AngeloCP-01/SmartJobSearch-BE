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
