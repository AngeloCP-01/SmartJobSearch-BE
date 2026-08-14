const { agent } = require('./helpers/testApp');
const { prisma, resetDb } = require('./helpers/db');
const { registerAndLogin } = require('./helpers/auth');

beforeEach(resetDb);
afterAll(async () => { await prisma.$disconnect(); });

const auth = (t) => ({ Authorization: `Bearer ${t}` });

async function seedAnalyses(userId, scores) {
  for (const atsScore of scores) {
    // eslint-disable-next-line no-await-in-loop
    await prisma.resumeAnalysis.create({
      data: {
        userId, atsScore, matchScore: atsScore, report: { meta: { position: 'Dev' } },
      },
    });
  }
}

test('paginates analyses newest-first by default', async () => {
  const { token, user } = await registerAndLogin();
  await seedAnalyses(user.id, [10, 20, 30]);

  const res = await agent().get('/api/v2/analysis?pageSize=10').set(auth(token));
  expect(res.body).toMatchObject({
    page: 1, pageSize: 10, total: 3, totalPages: 1,
  });
  expect(res.body.items).toHaveLength(3);
});

test('sorts by atsScore when asked', async () => {
  const { token, user } = await registerAndLogin();
  await seedAnalyses(user.id, [10, 30, 20]);
  const res = await agent().get('/api/v2/analysis?sort=atsScore&dir=asc').set(auth(token));
  expect(res.body.items.map((a) => a.atsScore)).toEqual([10, 20, 30]);
});

// documentName/position are read out of report JSON, not columns — sorting them
// in SQL would need JSON path queries. Deliberately unsupported; see the spec.
test('rejects sorting by a JSON-derived field', async () => {
  const { token } = await registerAndLogin();
  const res = await agent().get('/api/v2/analysis?sort=documentName').set(auth(token));
  expect(res.status).toBe(400);
});

test('still projects documentName and position from report JSON', async () => {
  const { token, user } = await registerAndLogin();
  await seedAnalyses(user.id, [42]);
  const res = await agent().get('/api/v2/analysis').set(auth(token));
  expect(res.body.items[0]).toMatchObject({ atsScore: 42, position: 'Dev' });
  expect(res.body.items[0]).toHaveProperty('documentName', null);
});

test('rejects an out-of-list pageSize with 400', async () => {
  const { token } = await registerAndLogin();
  const res = await agent().get('/api/v2/analysis?pageSize=7').set(auth(token));
  expect(res.status).toBe(400);
});

test('v1 analysis list is still a bare array', async () => {
  const { token, user } = await registerAndLogin();
  await seedAnalyses(user.id, [10]);
  const res = await agent().get('/api/analysis').set(auth(token));
  expect(Array.isArray(res.body)).toBe(true);
});

test('/api/v2/analysis/config is not swallowed by /:id', async () => {
  const { token } = await registerAndLogin();
  const res = await agent().get('/api/v2/analysis/config').set(auth(token));
  expect(res.status).toBe(200);
});
