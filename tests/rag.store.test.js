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
      VALUES (${`c${idx}`}, ${doc.id}, ${user.id}, ${idx}, ${content}, ${vec}::public.vector, now())`;
  }
  const probe = unit(0);
  // Qualify the distance operator — it lives in `public`, which isn't on the
  // per-worker schema search_path.
  const result = await prisma.$queryRaw`
    SELECT content, 1 - (embedding OPERATOR(public.<=>) ${probe}::public.vector) AS similarity
    FROM "DocumentChunk" WHERE "userId" = ${user.id}
    ORDER BY embedding OPERATOR(public.<=>) ${probe}::public.vector LIMIT 2`;
  expect(result[0].content).toBe('near text');
  expect(Number(result[0].similarity)).toBeGreaterThan(Number(result[1].similarity));
});

test('deleting a Document cascades to its chunks', async () => {
  const { user } = await registerAndLogin();
  const doc = await makeDoc(user.id);
  await prisma.$executeRaw`INSERT INTO "DocumentChunk" ("id","documentId","userId","chunkIndex","content","embedding","createdAt")
    VALUES (${'c0'}, ${doc.id}, ${user.id}, ${0}, ${'x'}, ${unit(0)}::public.vector, now())`;
  await prisma.document.delete({ where: { id: doc.id } });
  const remaining = await prisma.documentChunk.count({ where: { documentId: doc.id } });
  expect(remaining).toBe(0);
});
