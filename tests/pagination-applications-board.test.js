const { agent } = require('./helpers/testApp');
const { prisma, resetDb } = require('./helpers/db');
const { registerAndLogin } = require('./helpers/auth');
const { STATUSES } = require('../src/modules/applications/applications.schema');

beforeEach(resetDb);
afterAll(async () => { await prisma.$disconnect(); });

const auth = (t) => ({ Authorization: `Bearer ${t}` });

async function seed(token, rows) {
  for (const body of rows) {
    // eslint-disable-next-line no-await-in-loop
    await agent().post('/api/applications').set(auth(token)).send(body).expect(201);
  }
}

test('one request returns the first page of every status column with its total', async () => {
  const { token } = await registerAndLogin();
  await seed(token, [
    ...Array.from({ length: 12 }, (_, i) => ({ position: `Applied ${i}`, status: 'Applied' })),
    { position: 'Got one', status: 'Offer' },
  ]);
  const res = await agent().get('/api/v2/applications/board?pageSize=10').set(auth(token));
  expect(res.status).toBe(200);
  expect(Object.keys(res.body.columns).sort()).toEqual([...STATUSES].sort());
  expect(res.body.columns.Applied).toMatchObject({ page: 1, pageSize: 10, total: 12, totalPages: 2 });
  expect(res.body.columns.Applied.items).toHaveLength(10);
  expect(res.body.columns.Offer.items.map((a) => a.position)).toEqual(['Got one']);
  expect(res.body.columns.Draft).toMatchObject({ items: [], total: 0, totalPages: 0 });
});

test('a column\'s first page matches page 1 of the list for that status, so Load more continues it', async () => {
  const { token } = await registerAndLogin();
  await seed(token, Array.from({ length: 12 }, (_, i) => ({
    position: `Role ${i}`, status: 'Applied', applicationDate: `2026-06-${String(10 + (i % 3)).padStart(2, '0')}`,
  })));
  const board = await agent().get('/api/v2/applications/board?pageSize=10').set(auth(token));
  const list = await agent()
    .get('/api/v2/applications?status=Applied&page=1&pageSize=10&sort=applicationDate&dir=desc')
    .set(auth(token));
  expect(board.status).toBe(200);
  expect(list.status).toBe(200);
  expect(board.body.columns.Applied.items.map((a) => a.id)).toEqual(list.body.items.map((a) => a.id));
  const next = await agent()
    .get('/api/v2/applications?status=Applied&page=2&pageSize=10&sort=applicationDate&dir=desc')
    .set(auth(token)).expect(200);
  const ids = [...board.body.columns.Applied.items, ...next.body.items].map((a) => a.id);
  expect(ids).toHaveLength(12);
  expect(new Set(ids).size).toBe(12);
});

test('search and company filters narrow every column and its total', async () => {
  const { token } = await registerAndLogin();
  const company = await agent().post('/api/companies').set(auth(token)).send({ name: 'Acme' });
  await seed(token, [
    { position: 'Backend Eng', status: 'Applied', companyId: company.body.id },
    { position: 'Frontend Eng', status: 'Applied' },
  ]);
  const bySearch = await agent().get('/api/v2/applications/board?search=front').set(auth(token));
  expect(bySearch.body.columns.Applied.items.map((a) => a.position)).toEqual(['Frontend Eng']);
  expect(bySearch.body.columns.Applied.total).toBe(1);
  const byCompany = await agent().get(`/api/v2/applications/board?companyId=${company.body.id}`).set(auth(token));
  expect(byCompany.body.columns.Applied.items.map((a) => a.position)).toEqual(['Backend Eng']);
});

test('only returns the caller\'s own applications', async () => {
  const a = await registerAndLogin();
  const b = await registerAndLogin();
  await seed(a.token, [{ position: 'Mine', status: 'Applied' }]);
  const res = await agent().get('/api/v2/applications/board').set(auth(b.token));
  expect(res.body.columns.Applied.total).toBe(0);
});

test('rejects an off-allowlist pageSize and requires auth', async () => {
  const { token } = await registerAndLogin();
  expect((await agent().get('/api/v2/applications/board?pageSize=7').set(auth(token))).status).toBe(400);
  expect((await agent().get('/api/v2/applications/board')).status).toBe(401);
});


test('defaults to 10 rows per column and returns all empty columns', async () => {
  const { token } = await registerAndLogin();
  await seed(token, Array.from({ length: 11 }, (_, i) => ({ position: `Role ${i}`, status: 'Applied' })));
  const res = await agent().get('/api/v2/applications/board').set(auth(token)).expect(200);
  expect(res.body.columns.Applied).toMatchObject({ page: 1, pageSize: 10, total: 11, totalPages: 2 });
  expect(res.body.columns.Applied.items).toHaveLength(10);
  expect(res.body.columns.Withdrawn).toEqual({ items: [], page: 1, pageSize: 10, total: 0, totalPages: 0 });
});

test.each(['companyId=invalid', 'search=%20', 'pageSize=0', 'pageSize=1000'])(
  'rejects invalid board filters: %s', async (query) => {
    const { token } = await registerAndLogin();
    await agent().get(`/api/v2/applications/board?${query}`).set(auth(token)).expect(400);
  },
);
