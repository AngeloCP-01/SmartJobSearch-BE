const { agent } = require('./helpers/testApp');
const { prisma, resetDb } = require('./helpers/db');
const { registerAndLogin } = require('./helpers/auth');

beforeEach(resetDb);
afterAll(async () => { await prisma.$disconnect(); });

const auth = (t) => ({ Authorization: `Bearer ${t}` });

test('GET /api/activity requires authentication (401)', async () => {
  const res = await agent().get('/api/activity');
  expect(res.status).toBe(401);
});

test('an empty user gets an empty feed', async () => {
  const { token } = await registerAndLogin();
  const res = await agent().get('/api/activity').set(auth(token));
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ items: [], nextCursor: null });
});

test('creating an application logs ApplicationCreated', async () => {
  const { token } = await registerAndLogin();
  await agent().post('/api/applications').set(auth(token)).send({ position: 'Backend Engineer' });
  const res = await agent().get('/api/activity').set(auth(token));
  expect(res.body.items).toHaveLength(1);
  expect(res.body.items[0]).toMatchObject({
    action: 'ApplicationCreated',
    metadata: { position: 'Backend Engineer' },
  });
  expect(res.body.items[0].userId).toBeUndefined();
});

test('activity is scoped to the current user', async () => {
  const a = await registerAndLogin();
  const b = await registerAndLogin();
  await agent().post('/api/applications').set(auth(a.token)).send({ position: 'Theirs' });
  const res = await agent().get('/api/activity').set(auth(b.token));
  expect(res.body.items).toEqual([]);
});
