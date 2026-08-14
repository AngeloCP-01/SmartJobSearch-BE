const { agent } = require('./helpers/testApp');
const { prisma, resetDb } = require('./helpers/db');
const { registerAndLogin } = require('./helpers/auth');

beforeEach(resetDb);
afterAll(async () => { await prisma.$disconnect(); });

const auth = (t) => ({ Authorization: `Bearer ${t}` });

test('paginates companies and reports a filtered total', async () => {
  const { token } = await registerAndLogin();
  for (const name of ['Acme', 'Northwind', 'Initech', 'Acme Labs']) {
    // eslint-disable-next-line no-await-in-loop
    await agent().post('/api/companies').set(auth(token)).send({ name });
  }

  const page = await agent().get('/api/v2/companies?pageSize=10&page=1').set(auth(token));
  expect(page.body).toMatchObject({
    page: 1, pageSize: 10, total: 4, totalPages: 1,
  });

  const searched = await agent().get('/api/v2/companies?search=acme').set(auth(token));
  expect(searched.body.total).toBe(2);
});

test('sorts by name when asked', async () => {
  const { token } = await registerAndLogin();
  for (const name of ['Zebra Corp', 'Alpha Inc']) {
    // eslint-disable-next-line no-await-in-loop
    await agent().post('/api/companies').set(auth(token)).send({ name });
  }
  const res = await agent().get('/api/v2/companies?sort=name&dir=asc').set(auth(token));
  expect(res.body.items.map((c) => c.name)).toEqual(['Alpha Inc', 'Zebra Corp']);
});

test('rejects an out-of-list pageSize with 400', async () => {
  const { token } = await registerAndLogin();
  const res = await agent().get('/api/v2/companies?pageSize=7').set(auth(token));
  expect(res.status).toBe(400);
});

test('v1 companies list is still a bare array', async () => {
  const { token } = await registerAndLogin();
  await agent().post('/api/companies').set(auth(token)).send({ name: 'Acme' });
  const res = await agent().get('/api/companies').set(auth(token));
  expect(Array.isArray(res.body)).toBe(true);
});
