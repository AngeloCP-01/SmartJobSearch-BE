const { agent } = require('./helpers/testApp');
const { prisma, resetDb } = require('./helpers/db');
const { registerAndLogin } = require('./helpers/auth');

beforeEach(resetDb);
afterAll(async () => { await prisma.$disconnect(); });

const auth = (t) => ({ Authorization: `Bearer ${t}` });

test('create + list a company', async () => {
  const { token } = await registerAndLogin();
  const created = await agent().post('/api/companies').set(auth(token))
    .send({ name: 'Acme', industry: 'Tech' });
  expect(created.status).toBe(201);
  expect(created.body).toMatchObject({ name: 'Acme', industry: 'Tech' });

  const list = await agent().get('/api/companies').set(auth(token));
  expect(list.status).toBe(200);
  expect(list.body).toHaveLength(1);
});

test('create requires a name (400)', async () => {
  const { token } = await registerAndLogin();
  const res = await agent().post('/api/companies').set(auth(token)).send({ industry: 'Tech' });
  expect(res.status).toBe(400);
});

test('requires authentication (401)', async () => {
  const res = await agent().get('/api/companies');
  expect(res.status).toBe(401);
});

test('search filters by name (case-insensitive)', async () => {
  const { token } = await registerAndLogin();
  await agent().post('/api/companies').set(auth(token)).send({ name: 'Acme' });
  await agent().post('/api/companies').set(auth(token)).send({ name: 'Globex' });
  const res = await agent().get('/api/companies?search=acm').set(auth(token));
  expect(res.body).toHaveLength(1);
  expect(res.body[0].name).toBe('Acme');
});

test('update and delete a company', async () => {
  const { token } = await registerAndLogin();
  const c = await agent().post('/api/companies').set(auth(token)).send({ name: 'Acme' });
  const upd = await agent().patch(`/api/companies/${c.body.id}`).set(auth(token))
    .send({ location: 'Remote' });
  expect(upd.body.location).toBe('Remote');
  const del = await agent().delete(`/api/companies/${c.body.id}`).set(auth(token));
  expect(del.status).toBe(204);
  const after = await agent().get('/api/companies').set(auth(token));
  expect(after.body).toHaveLength(0);
});

test('a user cannot read another user\'s company (404)', async () => {
  const a = await registerAndLogin();
  const b = await registerAndLogin();
  const c = await agent().post('/api/companies').set(auth(a.token)).send({ name: 'Secret' });
  const res = await agent().get(`/api/companies/${c.body.id}`).set(auth(b.token));
  expect(res.status).toBe(404);
});
