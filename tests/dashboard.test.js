const { agent } = require('./helpers/testApp');
const { prisma, resetDb } = require('./helpers/db');
const { registerAndLogin } = require('./helpers/auth');

beforeEach(resetDb);
afterAll(async () => { await prisma.$disconnect(); });

const auth = (t) => ({ Authorization: `Bearer ${t}` });

test('summary reports totals, status counts, and upcoming interviews', async () => {
  const { token } = await registerAndLogin();
  const a = await agent().post('/api/applications').set(auth(token)).send({ position: 'A' });
  await agent().post('/api/applications').set(auth(token)).send({ position: 'B' });
  await agent().patch(`/api/applications/${a.body.id}/status`).set(auth(token))
    .send({ status: 'Applied' });

  const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  await agent().post('/api/interviews').set(auth(token))
    .send({ applicationId: a.body.id, type: 'HR', scheduledAt: future });
  await agent().post('/api/interviews').set(auth(token))
    .send({ applicationId: a.body.id, type: 'Technical', scheduledAt: past });

  const res = await agent().get('/api/dashboard/summary').set(auth(token));
  expect(res.status).toBe(200);
  expect(res.body.totalApplications).toBe(2);
  expect(res.body.byStatus.Applied).toBe(1);
  expect(res.body.byStatus.Draft).toBe(1);
  expect(res.body.upcomingInterviews).toHaveLength(1);
  expect(res.body.upcomingInterviews[0].type).toBe('HR');
});

test('summary requires authentication (401)', async () => {
  const res = await agent().get('/api/dashboard/summary');
  expect(res.status).toBe(401);
});

test('summary is scoped to the current user', async () => {
  const a = await registerAndLogin();
  const b = await registerAndLogin();
  await agent().post('/api/applications').set(auth(a.token)).send({ position: 'Theirs' });
  const res = await agent().get('/api/dashboard/summary').set(auth(b.token));
  expect(res.body.totalApplications).toBe(0);
});
