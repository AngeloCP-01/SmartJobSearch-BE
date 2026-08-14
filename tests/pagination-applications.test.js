const { agent } = require('./helpers/testApp');
const { prisma, resetDb } = require('./helpers/db');
const { registerAndLogin } = require('./helpers/auth');

beforeEach(resetDb);
afterAll(async () => { await prisma.$disconnect(); });

const auth = (t) => ({ Authorization: `Bearer ${t}` });

async function seed(token, n) {
  for (let i = 0; i < n; i += 1) {
    // Sequential: creation order defines createdAt, which is the default sort.
    // eslint-disable-next-line no-await-in-loop
    await agent().post('/api/applications').set(auth(token))
      .send({ position: `Role ${String(i).padStart(2, '0')}` });
  }
}

test('defaults to page 1 with pageSize 25 and an envelope', async () => {
  const { token } = await registerAndLogin();
  await seed(token, 3);
  const res = await agent().get('/api/v2/applications').set(auth(token));
  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({
    page: 1, pageSize: 25, total: 3, totalPages: 1,
  });
  expect(res.body.items).toHaveLength(3);
});

test('an empty list reports 0 totalPages', async () => {
  const { token } = await registerAndLogin();
  const res = await agent().get('/api/v2/applications').set(auth(token));
  expect(res.body).toMatchObject({ total: 0, totalPages: 0, items: [] });
});

test('slices across page boundaries and returns a partial last page', async () => {
  const { token } = await registerAndLogin();
  await seed(token, 12);

  const p1 = await agent().get('/api/v2/applications?page=1&pageSize=10').set(auth(token));
  expect(p1.body.items).toHaveLength(10);
  expect(p1.body).toMatchObject({ total: 12, totalPages: 2 });

  const p2 = await agent().get('/api/v2/applications?page=2&pageSize=10').set(auth(token));
  expect(p2.body.items).toHaveLength(2);

  const ids = new Set([...p1.body.items, ...p2.body.items].map((a) => a.id));
  expect(ids.size).toBe(12); // no overlap between pages
});

test('page past the end is an empty page, not a 404', async () => {
  const { token } = await registerAndLogin();
  await seed(token, 3);
  const res = await agent().get('/api/v2/applications?page=9&pageSize=10').set(auth(token));
  expect(res.status).toBe(200);
  expect(res.body.items).toEqual([]);
  expect(res.body.total).toBe(3);
});

test('total is the FILTERED count, not the table count', async () => {
  const { token } = await registerAndLogin();
  await seed(token, 5);
  const all = await agent().get('/api/v2/applications').set(auth(token));
  const target = all.body.items[0];
  await agent().patch(`/api/applications/${target.id}/status`).set(auth(token))
    .send({ status: 'Offer' });

  const res = await agent().get('/api/v2/applications?status=Offer').set(auth(token));
  expect(res.body.total).toBe(1);
  expect(res.body.items).toHaveLength(1);
});

test('search matches position and company name', async () => {
  const { token } = await registerAndLogin();
  const c = await agent().post('/api/companies').set(auth(token)).send({ name: 'Northwind' });
  await agent().post('/api/applications').set(auth(token)).send({ position: 'Backend Engineer' });
  await agent().post('/api/applications').set(auth(token))
    .send({ position: 'Designer', companyId: c.body.id });

  const byPosition = await agent().get('/api/v2/applications?search=backend').set(auth(token));
  expect(byPosition.body.total).toBe(1);

  const byCompany = await agent().get('/api/v2/applications?search=northwind').set(auth(token));
  expect(byCompany.body.total).toBe(1);
  expect(byCompany.body.items[0].position).toBe('Designer');
});

test('sorts by an allowlisted key and rejects an unknown one', async () => {
  const { token } = await registerAndLogin();
  await agent().post('/api/applications').set(auth(token)).send({ position: 'Zebra' });
  await agent().post('/api/applications').set(auth(token)).send({ position: 'Alpha' });

  const asc = await agent().get('/api/v2/applications?sort=position&dir=asc').set(auth(token));
  expect(asc.body.items.map((a) => a.position)).toEqual(['Alpha', 'Zebra']);

  const bad = await agent().get('/api/v2/applications?sort=dropTable').set(auth(token));
  expect(bad.status).toBe(400);
});

test('rejects an out-of-list pageSize with 400', async () => {
  const { token } = await registerAndLogin();
  const res = await agent().get('/api/v2/applications?pageSize=7').set(auth(token));
  expect(res.status).toBe(400);
  expect(res.body.error.code).toBe('VALIDATION');
});

test('v2 non-list routes behave exactly like v1', async () => {
  const { token } = await registerAndLogin();
  const created = await agent().post('/api/applications').set(auth(token)).send({ position: 'X' });
  const v1 = await agent().get(`/api/applications/${created.body.id}`).set(auth(token));
  const v2 = await agent().get(`/api/v2/applications/${created.body.id}`).set(auth(token));
  expect(v2.status).toBe(200);
  expect(v2.body).toEqual(v1.body);
});

test('v2 still requires auth', async () => {
  const res = await agent().get('/api/v2/applications');
  expect(res.status).toBe(401);
});

test('paging is stable when createdAt values tie', async () => {
  const { token, user } = await registerAndLogin();
  const sameInstant = new Date('2026-08-13T00:00:00.000Z');
  await prisma.application.createMany({
    data: Array.from({ length: 12 }, (_, i) => ({
      userId: user.id, position: `Role ${i}`, createdAt: sameInstant,
    })),
  });

  const p1 = await agent().get('/api/v2/applications?page=1&pageSize=10').set(auth(token));
  const p2 = await agent().get('/api/v2/applications?page=2&pageSize=10').set(auth(token));
  const ids = [...p1.body.items, ...p2.body.items].map((a) => a.id);
  expect(new Set(ids).size).toBe(12);
});
