const { agent } = require('./helpers/testApp');
const { prisma, resetDb } = require('./helpers/db');
const { registerAndLogin } = require('./helpers/auth');

beforeEach(resetDb);
afterAll(async () => { await prisma.$disconnect(); });

const auth = (t) => ({ Authorization: `Bearer ${t}` });

test('paginates contacts and searches name or email', async () => {
  const { token } = await registerAndLogin();
  await agent().post('/api/contacts').set(auth(token))
    .send({ name: 'Jordan Park', email: 'jordan@acme.test' });
  await agent().post('/api/contacts').set(auth(token))
    .send({ name: 'Dana Cole', email: 'dana@northwind.test' });
  await agent().post('/api/contacts').set(auth(token)).send({ name: 'Liam Cruz' });

  const all = await agent().get('/api/v2/contacts?pageSize=10').set(auth(token));
  expect(all.body).toMatchObject({ total: 3, totalPages: 1, pageSize: 10 });

  const byName = await agent().get('/api/v2/contacts?search=jordan').set(auth(token));
  expect(byName.body.total).toBe(1);

  const byEmail = await agent().get('/api/v2/contacts?search=northwind').set(auth(token));
  expect(byEmail.body.total).toBe(1);
});

test('filters by companyId', async () => {
  const { token } = await registerAndLogin();
  const c = await agent().post('/api/companies').set(auth(token)).send({ name: 'Acme' });
  await agent().post('/api/contacts').set(auth(token))
    .send({ name: 'Linked', companyId: c.body.id });
  await agent().post('/api/contacts').set(auth(token)).send({ name: 'Unlinked' });

  const res = await agent().get(`/api/v2/contacts?companyId=${c.body.id}`).set(auth(token));
  expect(res.body.total).toBe(1);
  expect(res.body.items[0].name).toBe('Linked');
});

test('rejects an out-of-list pageSize with 400', async () => {
  const { token } = await registerAndLogin();
  const res = await agent().get('/api/v2/contacts?pageSize=7').set(auth(token));
  expect(res.status).toBe(400);
});

test('v1 contacts list is still a bare array', async () => {
  const { token } = await registerAndLogin();
  await agent().post('/api/contacts').set(auth(token)).send({ name: 'Jordan Park' });
  const res = await agent().get('/api/contacts').set(auth(token));
  expect(Array.isArray(res.body)).toBe(true);
});
