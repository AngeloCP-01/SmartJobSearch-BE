const { agent } = require('./helpers/testApp');
const { prisma, resetDb } = require('./helpers/db');
const { registerAndLogin } = require('./helpers/auth');
const { PAGE_SIZES } = require('../src/shared/pagination');

beforeEach(resetDb);
afterAll(async () => { await prisma.$disconnect(); });

const auth = (t) => ({ Authorization: `Bearer ${t}` });

// Every v2 list endpoint, offset and cursor alike. A module wired without the
// shared query schema passes its own tests and fails here — which is the point.
const LIST_PATHS = [
  '/api/v2/applications',
  '/api/v2/companies',
  '/api/v2/contacts',
  '/api/v2/analysis',
  '/api/v2/activity',
];

// Offset endpoints only — activity is cursor-based and exposes no total.
const OFFSET_PATHS = LIST_PATHS.filter((p) => p !== '/api/v2/activity');

test.each(LIST_PATHS)('%s rejects an out-of-list pageSize', async (path) => {
  const { token } = await registerAndLogin();
  const res = await agent().get(`${path}?pageSize=7`).set(auth(token));
  expect(res.status).toBe(400);
  expect(res.body.error.code).toBe('VALIDATION');
});

test.each(LIST_PATHS)('%s accepts every allowlisted pageSize', async (path) => {
  const { token } = await registerAndLogin();
  for (const size of PAGE_SIZES) {
    // eslint-disable-next-line no-await-in-loop
    const res = await agent().get(`${path}?pageSize=${size}`).set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.pageSize).toBe(size);
  }
});

test.each(LIST_PATHS)('%s returns an items array', async (path) => {
  const { token } = await registerAndLogin();
  const res = await agent().get(path).set(auth(token));
  expect(Array.isArray(res.body.items)).toBe(true);
});

test.each(LIST_PATHS)('%s requires auth', async (path) => {
  const res = await agent().get(path);
  expect(res.status).toBe(401);
});

test.each(OFFSET_PATHS)('%s reports 0 totalPages when empty, not 1', async (path) => {
  const { token } = await registerAndLogin();
  const res = await agent().get(path).set(auth(token));
  expect(res.body).toMatchObject({ total: 0, totalPages: 0, page: 1 });
});

test.each(OFFSET_PATHS)('%s rejects an unknown sort key', async (path) => {
  const { token } = await registerAndLogin();
  const res = await agent().get(`${path}?sort=dropTable`).set(auth(token));
  expect(res.status).toBe(400);
});

// The v1 contract the frontend still depends on: a bare array, not an envelope.
const V1_LIST_PATHS = ['/api/applications', '/api/companies', '/api/contacts', '/api/analysis'];

test.each(V1_LIST_PATHS)('%s still returns a bare array', async (path) => {
  const { token } = await registerAndLogin();
  const res = await agent().get(path).set(auth(token));
  expect(Array.isArray(res.body)).toBe(true);
});
