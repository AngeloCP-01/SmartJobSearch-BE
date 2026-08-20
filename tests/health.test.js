jest.mock('../src/modules/analysis/engine/embeddings', () => ({
  embed: jest.fn().mockResolvedValue([[0.1, 0.2, 0.3]]),
  embeddingConfigured: () => true,
}));

const { agent } = require('./helpers/testApp');
const { prisma } = require('./helpers/db');

afterAll(async () => { await prisma.$disconnect(); });

test('GET /api/health returns ok', async () => {
  const res = await agent().get('/api/health');
  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({ status: 'ok' });
});

test('GET /api/health/deep returns 200 with db + storage + ai checks', async () => {
  const res = await agent().get('/api/health/deep');
  expect(res.status).toBe(200);
  expect(['ok', 'degraded']).toContain(res.body.status);
  expect(res.body.checks.db).toHaveProperty('ok');
  expect(res.body.checks.storage).toHaveProperty('ok');
  expect(res.body.checks.ai).toHaveProperty('ok');
  expect(res.body).toHaveProperty('version');
  expect(res.body).toHaveProperty('commit');
});

// The DB probe is throttled so a frequent uptime poll can't pin Neon awake;
// ?fresh=1 is the escape hatch for on-demand diagnostics.
test('GET /api/health/deep serves a cached db probe on repeat calls', async () => {
  await agent().get('/api/health/deep');
  const res = await agent().get('/api/health/deep');
  expect(res.body.checks.db.cached).toBe(true);
});

test('GET /api/health/deep?fresh=1 forces a live db probe', async () => {
  await agent().get('/api/health/deep');
  const res = await agent().get('/api/health/deep?fresh=1');
  expect(res.body.checks.db.cached).toBe(false);
});
