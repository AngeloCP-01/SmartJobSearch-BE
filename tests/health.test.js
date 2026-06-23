const { agent } = require('./helpers/testApp');
const { prisma } = require('./helpers/db');

afterAll(async () => { await prisma.$disconnect(); });

test('GET /api/health returns ok', async () => {
  const res = await agent().get('/api/health');
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ status: 'ok' });
});
