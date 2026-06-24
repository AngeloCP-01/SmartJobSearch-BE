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

async function makeApp(token, position = 'Eng') {
  return (await agent().post('/api/applications').set(auth(token)).send({ position })).body;
}

test('changing status logs ApplicationStatusChanged with from/to', async () => {
  const { token } = await registerAndLogin();
  const app = await makeApp(token);
  await agent().patch(`/api/applications/${app.id}/status`).set(auth(token)).send({ status: 'Applied' });
  const res = await agent().get(`/api/activity?applicationId=${app.id}`).set(auth(token));
  const statusEvents = res.body.items.filter((i) => i.action === 'ApplicationStatusChanged');
  expect(statusEvents).toHaveLength(1);
  expect(statusEvents[0].metadata).toMatchObject({ from: 'Draft', to: 'Applied', position: 'Eng' });
});

test('setting status to its current value logs nothing', async () => {
  const { token } = await registerAndLogin();
  const app = await makeApp(token);
  await agent().patch(`/api/applications/${app.id}/status`).set(auth(token)).send({ status: 'Draft' });
  const res = await agent().get(`/api/activity?applicationId=${app.id}`).set(auth(token));
  expect(res.body.items.filter((i) => i.action === 'ApplicationStatusChanged')).toHaveLength(0);
});

test('deleting an application logs ApplicationDeleted that survives the delete', async () => {
  const { token } = await registerAndLogin();
  const app = await makeApp(token, 'Doomed');
  await agent().delete(`/api/applications/${app.id}`).set(auth(token));
  const res = await agent().get('/api/activity').set(auth(token));
  const del = res.body.items.find((i) => i.action === 'ApplicationDeleted');
  expect(del).toBeTruthy();
  expect(del.applicationId).toBeNull();
  expect(del.metadata).toMatchObject({ position: 'Doomed' });
});
