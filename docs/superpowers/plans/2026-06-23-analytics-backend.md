# Analytics Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `GET /api/analytics` endpoint returning headline metrics, a status-distribution ("pipeline") breakdown, and applications-over-time — all scoped to the authenticated user.

**Architecture:** A new self-contained `src/modules/analytics/` module (routes → controller → service), mirroring the existing `dashboard/` module. The service composes Prisma counts/`groupBy` plus one parameterized raw query (`date_trunc`) via `Promise.all`. Read-only; no schema change.

**Tech Stack:** Express, Prisma (PostgreSQL), Jest + Supertest. No new dependencies.

## Global Constraints

- Every service function takes `userId` and filters **every** query by it (hard per-user isolation) — copied from the existing module pattern.
- JWT-protected: the router applies `requireAuth` (`req.userId` is set by the middleware).
- Standard error shape is handled by the existing `errorHandler`; controllers just `next(e)`.
- Status order is the canonical pipeline order, reused from `src/modules/applications/applications.schema.js` `STATUSES`: `Draft, Applied, HR_Screening, Technical_Interview, Final_Interview, Offer, Accepted, Rejected, Withdrawn`.
- Rates are fractions `0..1`; `0` when there are no applications (no divide-by-zero).
- Tests use the existing harness: `tests/helpers/testApp.js` (`agent`), `tests/helpers/db.js` (`prisma`, `resetDb`), `tests/helpers/auth.js` (`registerAndLogin`).
- Run the DB before tests: `docker compose up -d` (Postgres on host port 5434); `npm test` runs `jest --runInBand` and `prisma migrate deploy` via global setup.
- After backend changes, restart the dev server (`npm run dev` = plain `node src/server.js`, no auto-reload).
- Commit trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

### Task 1: Analytics module scaffold + endpoint contract (auth + empty shape)

Establishes the endpoint and the **full response skeleton** with zeroed values. Computation of real metrics/funnel/over-time is stubbed to zero here and driven by failing tests in Tasks 2–3.

**Files:**
- Create: `src/modules/analytics/analytics.service.js`
- Create: `src/modules/analytics/analytics.controller.js`
- Create: `src/modules/analytics/analytics.routes.js`
- Modify: `src/routes/index.js` (wire `/analytics`)
- Test: `tests/analytics.test.js`

**Interfaces:**
- Produces: `service.analytics(userId) → Promise<{ metrics: { totalApplications: number, interviewRate: number, offerRate: number, rejectionRate: number }, funnel: Array<{ status: string, count: number }>, overTime: Array<{ month: string, count: number }> }>` and `service.monthKeys(now?: Date) → string[]` (12 ascending `YYYY-MM` keys).
- Consumes: `requireAuth` from `src/shared/middleware/auth.js`; `STATUSES` from `src/modules/applications/applications.schema.js`.

- [ ] **Step 1: Write the failing test**

Create `tests/analytics.test.js`:

```js
const { agent } = require('./helpers/testApp');
const { prisma, resetDb } = require('./helpers/db');
const { registerAndLogin } = require('./helpers/auth');

beforeEach(resetDb);
afterAll(async () => { await prisma.$disconnect(); });

const auth = (t) => ({ Authorization: `Bearer ${t}` });

const STATUS_ORDER = [
  'Draft', 'Applied', 'HR_Screening', 'Technical_Interview',
  'Final_Interview', 'Offer', 'Accepted', 'Rejected', 'Withdrawn',
];

test('GET /api/analytics requires authentication (401)', async () => {
  const res = await agent().get('/api/analytics');
  expect(res.status).toBe(401);
});

test('an empty user gets a zeroed, fully-shaped payload', async () => {
  const { token } = await registerAndLogin();
  const res = await agent().get('/api/analytics').set(auth(token));

  expect(res.status).toBe(200);
  expect(res.body.metrics).toEqual({
    totalApplications: 0, interviewRate: 0, offerRate: 0, rejectionRate: 0,
  });
  expect(res.body.funnel).toHaveLength(9);
  expect(res.body.funnel.map((f) => f.status)).toEqual(STATUS_ORDER);
  expect(res.body.funnel.every((f) => f.count === 0)).toBe(true);
  expect(res.body.overTime).toHaveLength(12);
  expect(res.body.overTime.every((b) => b.count === 0)).toBe(true);
  expect(res.body.overTime[0].month).toMatch(/^\d{4}-\d{2}$/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- analytics`
Expected: FAIL — `404` (route not wired) so the assertions on `res.body.metrics` fail.

- [ ] **Step 3: Create the service (stubbed computation, real shape)**

Create `src/modules/analytics/analytics.service.js`:

```js
const prisma = require('../../shared/database/prisma');
const { STATUSES } = require('../applications/applications.schema');

const MONTHS = 12;

// 12 ascending 'YYYY-MM' keys ending at the current (UTC) month.
function monthKeys(now = new Date()) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  d.setUTCMonth(d.getUTCMonth() - (MONTHS - 1));
  const keys = [];
  for (let i = 0; i < MONTHS; i += 1) {
    keys.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return keys;
}

async function analytics(userId) {
  const total = await prisma.application.count({ where: { userId } });
  return {
    metrics: { totalApplications: total, interviewRate: 0, offerRate: 0, rejectionRate: 0 },
    funnel: STATUSES.map((status) => ({ status, count: 0 })),
    overTime: monthKeys().map((month) => ({ month, count: 0 })),
  };
}

module.exports = { analytics, monthKeys };
```

- [ ] **Step 4: Create the controller**

Create `src/modules/analytics/analytics.controller.js`:

```js
const service = require('./analytics.service');

async function analytics(req, res, next) {
  try { res.json(await service.analytics(req.userId)); }
  catch (e) { next(e); }
}

module.exports = { analytics };
```

- [ ] **Step 5: Create the routes**

Create `src/modules/analytics/analytics.routes.js`:

```js
const { Router } = require('express');
const { requireAuth } = require('../../shared/middleware/auth');
const ctrl = require('./analytics.controller');

const router = Router();
router.use(requireAuth);

router.get('/', ctrl.analytics);

module.exports = router;
```

- [ ] **Step 6: Wire the module into the app router**

Modify `src/routes/index.js` — add the require alongside the others and mount it after `dashboard`:

```js
const analyticsRoutes = require('../modules/analytics/analytics.routes');
```
```js
router.use('/analytics', analyticsRoutes);
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npm test -- analytics`
Expected: PASS (both tests).

- [ ] **Step 8: Commit**

```bash
git add src/modules/analytics src/routes/index.js tests/analytics.test.js
git commit -m "feat(analytics): scaffold GET /api/analytics endpoint (auth + empty shape)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Headline metrics + pipeline funnel

Drives the real metric math (interview/offer/rejection rates) and per-status funnel counts.

**Files:**
- Modify: `src/modules/analytics/analytics.service.js`
- Test: `tests/analytics.test.js` (append)

**Interfaces:**
- Consumes: `service.analytics(userId)` (Task 1). Uses Prisma `application.count`, `application.groupBy`, and the `interviews: { some: {} }` relation filter.
- Produces: unchanged signature; `metrics` and `funnel` now reflect real data.

- [ ] **Step 1: Write the failing test (append to `tests/analytics.test.js`)**

```js
test('metrics and funnel reflect seeded applications and interviews', async () => {
  const { token } = await registerAndLogin();

  const mk = async (status) => {
    const r = await agent().post('/api/applications').set(auth(token)).send({ position: status });
    if (status !== 'Draft') {
      await agent().patch(`/api/applications/${r.body.id}/status`).set(auth(token)).send({ status });
    }
    return r.body.id;
  };
  const addInterview = (id) =>
    agent().post('/api/interviews').set(auth(token)).send({ applicationId: id, type: 'HR' });

  await mk('Draft');                              // no interview
  const applied = await mk('Applied');           // interview
  const tech = await mk('Technical_Interview');  // interview
  const offer = await mk('Offer');               // interview
  const rejected = await mk('Rejected');         // interview
  await Promise.all([applied, tech, offer, rejected].map(addInterview));

  const res = await agent().get('/api/analytics').set(auth(token));
  expect(res.body.metrics.totalApplications).toBe(5);
  expect(res.body.metrics.interviewRate).toBeCloseTo(4 / 5);  // 4 of 5 have an interview
  expect(res.body.metrics.offerRate).toBeCloseTo(1 / 5);      // Offer + Accepted
  expect(res.body.metrics.rejectionRate).toBeCloseTo(1 / 5);  // Rejected

  const byStatus = Object.fromEntries(res.body.funnel.map((f) => [f.status, f.count]));
  expect(byStatus.Draft).toBe(1);
  expect(byStatus.Applied).toBe(1);
  expect(byStatus.Technical_Interview).toBe(1);
  expect(byStatus.Offer).toBe(1);
  expect(byStatus.Rejected).toBe(1);
  expect(byStatus.Accepted).toBe(0);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- analytics -t "metrics and funnel"`
Expected: FAIL — rates are `0` and funnel counts are `0` (Task 1 stub).

- [ ] **Step 3: Implement metrics + funnel in the service**

Replace the `analytics` function in `src/modules/analytics/analytics.service.js` with:

```js
async function analytics(userId) {
  const [total, interviewed, grouped] = await Promise.all([
    prisma.application.count({ where: { userId } }),
    prisma.application.count({ where: { userId, interviews: { some: {} } } }),
    prisma.application.groupBy({ by: ['status'], where: { userId }, _count: { _all: true } }),
  ]);

  const byStatus = Object.fromEntries(grouped.map((g) => [g.status, g._count._all]));
  const rate = (n) => (total === 0 ? 0 : n / total);
  const offers = (byStatus.Offer || 0) + (byStatus.Accepted || 0);

  return {
    metrics: {
      totalApplications: total,
      interviewRate: rate(interviewed),
      offerRate: rate(offers),
      rejectionRate: rate(byStatus.Rejected || 0),
    },
    funnel: STATUSES.map((status) => ({ status, count: byStatus[status] || 0 })),
    overTime: monthKeys().map((month) => ({ month, count: 0 })),
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- analytics`
Expected: PASS (Task 1 tests still green + the new metrics/funnel test).

- [ ] **Step 5: Commit**

```bash
git add src/modules/analytics/analytics.service.js tests/analytics.test.js
git commit -m "feat(analytics): headline metrics + pipeline funnel counts

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Applications over time (monthly buckets, 12-month window)

Drives the raw `date_trunc` query: monthly counts over the last 12 months, bucketed by `COALESCE(applicationDate, createdAt)`, zero-filled, out-of-window apps excluded.

**Files:**
- Modify: `src/modules/analytics/analytics.service.js`
- Test: `tests/analytics.test.js` (append)

**Interfaces:**
- Consumes: `service.monthKeys` (Task 1). Adds an internal `overTime(userId)` helper using `prisma.$queryRaw` with parameterized `userId` and `start`.
- Produces: `overTime` in the payload now reflects real per-month counts.

- [ ] **Step 1: Write the failing test (append to `tests/analytics.test.js`)**

Add these helpers near the top of the file (below `STATUS_ORDER`):

```js
const MONTHS = 12;
function monthKeysForTest(now = new Date()) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  d.setUTCMonth(d.getUTCMonth() - (MONTHS - 1));
  const keys = [];
  for (let i = 0; i < MONTHS; i += 1) {
    keys.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return keys;
}
function midMonth(key) {
  const [y, m] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 15, 12, 0, 0)); // mid-month noon → TZ-safe bucket
}
```

Then the test:

```js
test('over time buckets by month with applicationDate/createdAt fallback and zero-fill', async () => {
  const { user, token } = await registerAndLogin();
  const keys = monthKeysForTest();
  const current = keys[11];
  const prior = keys[6];

  // 2 in the current month via applicationDate
  await prisma.application.createMany({ data: [
    { userId: user.id, position: 'a', applicationDate: midMonth(current) },
    { userId: user.id, position: 'b', applicationDate: midMonth(current) },
  ] });
  // 1 in a prior in-window month via the createdAt fallback (applicationDate null)
  await prisma.application.create({
    data: { userId: user.id, position: 'c', createdAt: midMonth(prior) },
  });
  // 1 OUTSIDE the window (13 months back) — must be excluded
  const now = new Date();
  const outOfWindow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 13, 15, 12, 0, 0));
  await prisma.application.create({
    data: { userId: user.id, position: 'old', applicationDate: outOfWindow },
  });

  const res = await agent().get('/api/analytics').set(auth(token));
  expect(res.body.overTime).toHaveLength(12);
  const counts = Object.fromEntries(res.body.overTime.map((b) => [b.month, b.count]));
  expect(counts[current]).toBe(2);
  expect(counts[prior]).toBe(1);
  // only the 3 in-window apps are counted across the whole window
  expect(res.body.overTime.reduce((s, b) => s + b.count, 0)).toBe(3);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- analytics -t "over time buckets"`
Expected: FAIL — `counts[current]` is `0` (Task 1/2 over-time stub).

- [ ] **Step 3: Implement the raw monthly aggregation**

In `src/modules/analytics/analytics.service.js`, add the `overTime` helper above `analytics`:

```js
async function overTime(userId) {
  const keys = monthKeys();
  const start = new Date(`${keys[0]}-01T00:00:00.000Z`);
  const rows = await prisma.$queryRaw`
    SELECT to_char(date_trunc('month', COALESCE("applicationDate", "createdAt")), 'YYYY-MM') AS month,
           COUNT(*)::int AS count
    FROM "Application"
    WHERE "userId" = ${userId}
      AND COALESCE("applicationDate", "createdAt") >= ${start}
    GROUP BY 1
  `;
  const counts = Object.fromEntries(rows.map((r) => [r.month, Number(r.count)]));
  return keys.map((month) => ({ month, count: counts[month] || 0 }));
}
```

Then update `analytics` to compute it in the `Promise.all` and return it (replace the stubbed `overTime` line):

```js
async function analytics(userId) {
  const [total, interviewed, grouped, over] = await Promise.all([
    prisma.application.count({ where: { userId } }),
    prisma.application.count({ where: { userId, interviews: { some: {} } } }),
    prisma.application.groupBy({ by: ['status'], where: { userId }, _count: { _all: true } }),
    overTime(userId),
  ]);

  const byStatus = Object.fromEntries(grouped.map((g) => [g.status, g._count._all]));
  const rate = (n) => (total === 0 ? 0 : n / total);
  const offers = (byStatus.Offer || 0) + (byStatus.Accepted || 0);

  return {
    metrics: {
      totalApplications: total,
      interviewRate: rate(interviewed),
      offerRate: rate(offers),
      rejectionRate: rate(byStatus.Rejected || 0),
    },
    funnel: STATUSES.map((status) => ({ status, count: byStatus[status] || 0 })),
    overTime: over,
  };
}
```

> Note: column identifiers are double-quoted (`"applicationDate"`, `"createdAt"`, `"userId"`) because Prisma maps camelCase fields to camelCase columns; `userId` and `start` are bound parameters (never interpolated). `COUNT(*)::int` returns a JS number rather than a BigInt.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- analytics`
Expected: PASS (all analytics tests green).

- [ ] **Step 5: Commit**

```bash
git add src/modules/analytics/analytics.service.js tests/analytics.test.js
git commit -m "feat(analytics): applications-over-time monthly aggregation

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Cross-user isolation + full-suite verification

Locks in per-user isolation and confirms the whole backend suite is green.

**Files:**
- Test: `tests/analytics.test.js` (append)

**Interfaces:**
- Consumes: `service.analytics(userId)` (final form). No production code change expected.

- [ ] **Step 1: Write the isolation test (append to `tests/analytics.test.js`)**

```js
test('analytics is scoped to the current user', async () => {
  const a = await registerAndLogin();
  const b = await registerAndLogin();

  const r = await agent().post('/api/applications').set(auth(a.token)).send({ position: 'Theirs' });
  await agent().patch(`/api/applications/${r.body.id}/status`).set(auth(a.token)).send({ status: 'Offer' });
  await agent().post('/api/interviews').set(auth(a.token)).send({ applicationId: r.body.id, type: 'HR' });

  const res = await agent().get('/api/analytics').set(auth(b.token));
  expect(res.body.metrics.totalApplications).toBe(0);
  expect(res.body.metrics.offerRate).toBe(0);
  expect(res.body.funnel.every((f) => f.count === 0)).toBe(true);
  expect(res.body.overTime.every((bk) => bk.count === 0)).toBe(true);
});
```

- [ ] **Step 2: Run the analytics tests**

Run: `npm test -- analytics`
Expected: PASS. (User A's data never appears for user B — the `where: { userId }` filters and the parameterized raw query enforce this. If it fails, the bug is a missing `userId` filter — fix the service, do not weaken the test.)

- [ ] **Step 3: Run the full backend suite**

Run: `npm test`
Expected: PASS — the prior 69 tests plus the 5 new analytics tests (74 total).

- [ ] **Step 4: Restart the dev server (manual smoke, optional)**

The dev server has no auto-reload. If running, restart it so the new route is live:

```bash
# stop the running server, then:
npm run dev   # node src/server.js, BE on :4000
```

- [ ] **Step 5: Commit**

```bash
git add tests/analytics.test.js
git commit -m "test(analytics): cross-user isolation

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

- **Spec coverage:** endpoint `GET /api/analytics` (Task 1) ✓; metrics total/interview/offer/rejection with the chosen interview-record definition (Task 2) ✓; pipeline funnel = 9 statuses canonical order zero-filled (Tasks 1–2) ✓; applications-over-time 12 months `COALESCE(applicationDate, createdAt)` zero-filled (Task 3) ✓; auth 401 (Task 1) ✓; empty-data zeros (Task 1) ✓; cross-user isolation (Task 4) ✓; no schema change ✓.
- **Type consistency:** `service.analytics(userId)` and `service.monthKeys(now?)` names/shape are stable across tasks; `funnel` entries are `{ status, count }`, `overTime` entries are `{ month, count }`, `metrics` keys are `totalApplications/interviewRate/offerRate/rejectionRate` throughout.
- **Placeholders:** none — every step has complete code and exact commands.
