const { agent } = require('./helpers/testApp');
const { prisma, resetDb } = require('./helpers/db');
const { registerAndLogin } = require('./helpers/auth');

beforeEach(resetDb);
afterAll(async () => { await prisma.$disconnect(); });

const auth = (t) => ({ Authorization: `Bearer ${t}` });

// Seeded directly rather than through 12 sequential POSTs: this file is about
// paging, not the write path, and driving it over HTTP made the test depend on
// a dozen round trips all succeeding — fragile under machine load, and it
// leaves createdAt at whatever the clock happened to produce.
async function seedEvents(userId, n, { createdAt } = {}) {
  await prisma.activityLog.createMany({
    data: Array.from({ length: n }, (_, i) => ({
      userId,
      action: 'ApplicationCreated',
      metadata: { position: `Role ${i}` },
      // Explicit, strictly-decreasing timestamps unless the caller wants ties.
      createdAt: createdAt ?? new Date(Date.UTC(2026, 0, 1, 0, 0, 0) + i * 1000),
    })),
  });
}

test('returns a cursor envelope with pageSize and no total', async () => {
  const { token, user } = await registerAndLogin();
  await seedEvents(user.id, 3);
  const res = await agent().get('/api/v2/activity?pageSize=10').set(auth(token));
  expect(res.status).toBe(200);
  expect(res.body).toHaveProperty('items');
  expect(res.body.pageSize).toBe(10);
  expect(res.body).not.toHaveProperty('total');
  expect(res.body).not.toHaveProperty('totalPages');
});

test('nextCursor is null on the final page', async () => {
  const { token, user } = await registerAndLogin();
  await seedEvents(user.id, 3);
  const res = await agent().get('/api/v2/activity?pageSize=10').set(auth(token));
  expect(res.body.nextCursor).toBeNull();
});

test('paging by cursor yields no duplicate ids', async () => {
  const { token, user } = await registerAndLogin();
  await seedEvents(user.id, 12);

  const p1 = await agent().get('/api/v2/activity?pageSize=10').set(auth(token));
  expect(p1.body.items).toHaveLength(10);
  expect(p1.body.nextCursor).toBeTruthy();

  const p2 = await agent()
    .get(`/api/v2/activity?pageSize=10&before=${encodeURIComponent(p1.body.nextCursor)}`)
    .set(auth(token));

  const ids = new Set([...p1.body.items, ...p2.body.items].map((e) => e.id));
  expect(ids.size).toBe(p1.body.items.length + p2.body.items.length);
});

test('rejects an out-of-list pageSize with 400', async () => {
  const { token } = await registerAndLogin();
  const res = await agent().get('/api/v2/activity?pageSize=7').set(auth(token));
  expect(res.status).toBe(400);
});

// v1 keeps `limit` and keeps clamping; v2 renames it to pageSize and validates.
test('v1 activity still clamps limit instead of rejecting it', async () => {
  const { token, user } = await registerAndLogin();
  await seedEvents(user.id, 3);
  const res = await agent().get('/api/activity?limit=7').set(auth(token));
  expect(res.status).toBe(200);
  expect(res.body).toHaveProperty('items');
});

// The cursor is serialised as `createdAt.toISOString()|id`, which is
// millisecond precision, while Postgres stores microseconds. Rows sharing a
// millisecond therefore exercise the tie-break branch of cursorFilter and are
// where a truncated cursor would silently drop rows between pages.
test('paging is lossless when rows share a timestamp', async () => {
  const { token, user } = await registerAndLogin();
  const tied = new Date('2026-01-01T00:00:00.000Z');
  await seedEvents(user.id, 12, { createdAt: tied });

  const p1 = await agent().get('/api/v2/activity?pageSize=10').set(auth(token));
  expect(p1.body.items).toHaveLength(10);
  expect(p1.body.nextCursor).toBeTruthy();

  const p2 = await agent()
    .get(`/api/v2/activity?pageSize=10&before=${encodeURIComponent(p1.body.nextCursor)}`)
    .set(auth(token));

  const ids = [...p1.body.items, ...p2.body.items].map((e) => e.id);
  expect(new Set(ids).size).toBe(12); // nothing dropped, nothing repeated
});
