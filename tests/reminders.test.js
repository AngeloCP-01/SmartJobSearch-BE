const { agent } = require('./helpers/testApp');
const { prisma, resetDb } = require('./helpers/db');
const { registerAndLogin } = require('./helpers/auth');

beforeEach(resetDb);
afterAll(async () => { await prisma.$disconnect(); });

const auth = (t) => ({ Authorization: `Bearer ${t}` });
const daysFromNow = (n) => new Date(Date.now() + n * 24 * 60 * 60 * 1000).toISOString();

test('GET /api/reminders requires authentication (401)', async () => {
  const res = await agent().get('/api/reminders');
  expect(res.status).toBe(401);
});

test('an empty user gets a fully-shaped, zeroed payload', async () => {
  const { token } = await registerAndLogin();
  const res = await agent().get('/api/reminders').set(auth(token));

  expect(res.status).toBe(200);
  expect(res.body.interviews).toEqual({ upcoming: [], overdue: [] });
  expect(res.body.followUps).toEqual({ due: [], upcoming: [] });
  expect(res.body.counts).toEqual({ total: 0, interviews: 0, followUps: 0 });
});
