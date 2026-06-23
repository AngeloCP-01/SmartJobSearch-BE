# Reminders Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only `GET /api/reminders` endpoint returning grouped upcoming/overdue interviews and due/upcoming follow-ups, plus allow clearing a contact's `followUpDate` via `PATCH`.

**Architecture:** A new self-contained `src/modules/reminders/` module (routes → controller → service) mirroring the `dashboard`/`analytics` modules; the service composes four `userId`-scoped Prisma queries via `Promise.all`. A one-line Zod widening lets `PATCH /api/contacts/:id` accept `followUpDate: null`. No DB migration.

**Tech Stack:** Express, Prisma (PostgreSQL), Zod, Jest + Supertest. No new dependencies.

## Global Constraints

- Every service function takes `userId` and filters **every** query by it (hard per-user isolation).
- JWT-protected: the router applies `requireAuth` (`req.userId` set by the middleware); controllers just `next(e)`.
- Time window: `now = new Date()`, `windowEnd = now + 7 days` (`7 * 24 * 60 * 60 * 1000` ms). All filters use these `Date` bounds (datetime comparisons; null dates never match).
- Buckets (all `userId`-scoped):
  - `interviews.upcoming`: `scheduledAt >= now AND <= windowEnd`, order `scheduledAt asc`.
  - `interviews.overdue`: `scheduledAt < now AND (result = null OR 'Pending')`, order `scheduledAt desc`.
  - `followUps.due`: `followUpDate <= now`, order `followUpDate asc`.
  - `followUps.upcoming`: `followUpDate > now AND <= windowEnd`, order `followUpDate asc`.
- `counts`: `{ interviews: upcoming+overdue, followUps: due+upcoming, total: sum }`.
- Tests use the existing harness: `tests/helpers/testApp.js` (`agent`), `tests/helpers/db.js` (`prisma`, `resetDb`), `tests/helpers/auth.js` (`registerAndLogin`).
- Run the DB before tests: `docker compose up -d` (Postgres on host port 5434); `npm test` runs `jest --runInBand` + `prisma migrate deploy` via global setup.
- After backend changes, restart the dev server (`npm run dev` = plain `node src/server.js`, no auto-reload).
- Commit trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

### Task 1: Allow clearing `followUpDate` via PATCH (contacts schema widening)

Enables the frontend "mark follow-up done" action. Isolated, independently testable.

**Files:**
- Modify: `src/modules/contacts/contacts.schema.js`
- Test: `tests/contacts.test.js` (append)

**Interfaces:**
- Consumes: existing `PATCH /api/contacts/:id` (validate(updateContactSchema) → `contacts.service.update`, which passes `data` straight to `prisma.contact.update`).
- Produces: `updateContactSchema` now accepts `followUpDate: null` (clears the column).

- [ ] **Step 1: Write the failing test (append to `tests/contacts.test.js`)**

```js
test('PATCH /contacts/:id clears followUpDate with null', async () => {
  const { token } = await registerAndLogin();
  const created = await agent().post('/api/contacts').set(auth(token))
    .send({ name: 'Recruiter', followUpDate: '2026-06-20T00:00:00.000Z' });
  expect(created.body.followUpDate).not.toBeNull();

  const patched = await agent().patch(`/api/contacts/${created.body.id}`).set(auth(token))
    .send({ followUpDate: null });
  expect(patched.status).toBe(200);
  expect(patched.body.followUpDate).toBeNull();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- contacts -t "clears followUpDate"`
Expected: FAIL — `z.coerce.date().optional()` coerces `null` to the epoch (or rejects), so `patched.body.followUpDate` is not `null`.

- [ ] **Step 3: Widen the schema**

In `src/modules/contacts/contacts.schema.js`, change the `followUpDate` line in `baseFields`:

```js
  followUpDate: z.coerce.date().nullable().optional(),
```

(`ZodNullable` short-circuits `null` before the date coercion, matching the existing `companyId: z.string().uuid().nullable().optional()` pattern; the service already forwards `null` to Prisma, which sets the column null.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- contacts`
Expected: PASS (the new test + all existing contacts tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/contacts/contacts.schema.js tests/contacts.test.js
git commit -m "feat(contacts): allow PATCH followUpDate: null to clear a follow-up

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Reminders module scaffold + endpoint contract (auth + empty shape)

Establishes the endpoint and the full response skeleton with empty buckets. Real bucketing is stubbed here and driven by Task 3's failing test.

**Files:**
- Create: `src/modules/reminders/reminders.service.js`
- Create: `src/modules/reminders/reminders.controller.js`
- Create: `src/modules/reminders/reminders.routes.js`
- Modify: `src/routes/index.js` (wire `/reminders`)
- Test: `tests/reminders.test.js`

**Interfaces:**
- Produces: `service.reminders(userId) → Promise<{ interviews: { upcoming: Item[], overdue: Item[] }, followUps: { due: F[], upcoming: F[] }, counts: { total: number, interviews: number, followUps: number } }>` where `Item = { id, type, scheduledAt, result, application: { id, position, company: { id, name } | null } }` and `F = { id, name, position, followUpDate, company: { id, name } | null }`.
- Consumes: `requireAuth` from `src/shared/middleware/auth.js`.

- [ ] **Step 1: Write the failing test**

Create `tests/reminders.test.js`:

```js
const { agent } = require('./helpers/testApp');
const { prisma, resetDb } = require('./helpers/db');
const { registerAndLogin } = require('./helpers/auth');

beforeEach(resetDb);
afterAll(async () => { await prisma.$disconnect(); });

const auth = (t) => ({ Authorization: `Bearer ${t}` });
const daysFromNow = (n) => new Date(Date.now() + n * 24 * 60 * 60 * 1000).toISOString();

test('GET /api/reminders requires authentication (401)', async () => {
  const res = await agent().get('/api/reminders');
  expect(res.status).toBe(401);
});

test('an empty user gets a fully-shaped, zeroed payload', async () => {
  const { token } = await registerAndLogin();
  const res = await agent().get('/api/reminders').set(auth(token));

  expect(res.status).toBe(200);
  expect(res.body.interviews).toEqual({ upcoming: [], overdue: [] });
  expect(res.body.followUps).toEqual({ due: [], upcoming: [] });
  expect(res.body.counts).toEqual({ total: 0, interviews: 0, followUps: 0 });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- reminders`
Expected: FAIL — `404` (route not wired), so the body assertions fail.

- [ ] **Step 3: Create the service (stubbed empty buckets)**

Create `src/modules/reminders/reminders.service.js`:

```js
const prisma = require('../../shared/database/prisma');

const WINDOW_DAYS = 7;

const interviewInclude = {
  application: {
    select: { id: true, position: true, company: { select: { id: true, name: true } } },
  },
};
const companyInclude = { company: { select: { id: true, name: true } } };

const shapeInterview = (i) => ({
  id: i.id, type: i.type, scheduledAt: i.scheduledAt, result: i.result, application: i.application,
});
const shapeFollowUp = (c) => ({
  id: c.id, name: c.name, position: c.position, followUpDate: c.followUpDate, company: c.company,
});

async function reminders(userId) {
  void prisma; void WINDOW_DAYS; void interviewInclude; void companyInclude;
  void shapeInterview; void shapeFollowUp; void userId;
  const interviews = { upcoming: [], overdue: [] };
  const followUps = { due: [], upcoming: [] };
  return {
    interviews,
    followUps,
    counts: { total: 0, interviews: 0, followUps: 0 },
  };
}

module.exports = { reminders };
```

- [ ] **Step 4: Create the controller**

Create `src/modules/reminders/reminders.controller.js`:

```js
const service = require('./reminders.service');

async function reminders(req, res, next) {
  try { res.json(await service.reminders(req.userId)); }
  catch (e) { next(e); }
}

module.exports = { reminders };
```

- [ ] **Step 5: Create the routes**

Create `src/modules/reminders/reminders.routes.js`:

```js
const { Router } = require('express');
const { requireAuth } = require('../../shared/middleware/auth');
const ctrl = require('./reminders.controller');

const router = Router();
router.use(requireAuth);

router.get('/', ctrl.reminders);

module.exports = router;
```

- [ ] **Step 6: Wire the module into the app router**

Modify `src/routes/index.js` — add the require alongside the others and mount it after `analytics`:

```js
const remindersRoutes = require('../modules/reminders/reminders.routes');
```
```js
router.use('/reminders', remindersRoutes);
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npm test -- reminders`
Expected: PASS (both tests).

- [ ] **Step 8: Commit**

```bash
git add src/modules/reminders src/routes/index.js tests/reminders.test.js
git commit -m "feat(reminders): scaffold GET /api/reminders endpoint (auth + empty shape)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Bucketing logic (categorize interviews + follow-ups)

Drives the four real queries with a seeded scenario.

**Files:**
- Modify: `src/modules/reminders/reminders.service.js`
- Test: `tests/reminders.test.js` (append)

**Interfaces:**
- Consumes: `service.reminders(userId)` (Task 2). Uses `prisma.interview.findMany` + `prisma.contact.findMany`.
- Produces: unchanged signature; buckets and counts now reflect real data.

- [ ] **Step 1: Write the failing test (append to `tests/reminders.test.js`)**

```js
test('categorizes interviews and follow-ups into the right buckets', async () => {
  const { token } = await registerAndLogin();
  const companyId = (await agent().post('/api/companies').set(auth(token)).send({ name: 'Acme' })).body.id;
  const appId = (await agent().post('/api/applications').set(auth(token))
    .send({ position: 'Backend Engineer', companyId })).body.id;

  // interviews
  await agent().post('/api/interviews').set(auth(token))
    .send({ applicationId: appId, type: 'Technical', scheduledAt: daysFromNow(2) });        // upcoming
  await agent().post('/api/interviews').set(auth(token))
    .send({ applicationId: appId, type: 'Final', scheduledAt: daysFromNow(30) });           // beyond window → excluded
  await agent().post('/api/interviews').set(auth(token))
    .send({ applicationId: appId, type: 'HR', scheduledAt: daysFromNow(-2) });               // overdue (result null)
  await agent().post('/api/interviews').set(auth(token))
    .send({ applicationId: appId, type: 'Managerial', scheduledAt: daysFromNow(-3), result: 'Passed' }); // excluded

  // follow-ups
  await agent().post('/api/contacts').set(auth(token))
    .send({ name: 'Due Person', companyId, followUpDate: daysFromNow(-3) });                 // due
  await agent().post('/api/contacts').set(auth(token))
    .send({ name: 'Soon Person', followUpDate: daysFromNow(3) });                            // upcoming
  await agent().post('/api/contacts').set(auth(token))
    .send({ name: 'Later Person', followUpDate: daysFromNow(30) });                          // excluded
  await agent().post('/api/contacts').set(auth(token))
    .send({ name: 'No Date Person' });                                                       // excluded (null)

  const res = await agent().get('/api/reminders').set(auth(token));

  expect(res.body.interviews.upcoming).toHaveLength(1);
  expect(res.body.interviews.upcoming[0].type).toBe('Technical');
  expect(res.body.interviews.upcoming[0].application.position).toBe('Backend Engineer');
  expect(res.body.interviews.upcoming[0].application.company.name).toBe('Acme');
  expect(res.body.interviews.overdue).toHaveLength(1);
  expect(res.body.interviews.overdue[0].type).toBe('HR');

  expect(res.body.followUps.due.map((f) => f.name)).toEqual(['Due Person']);
  expect(res.body.followUps.upcoming.map((f) => f.name)).toEqual(['Soon Person']);

  expect(res.body.counts).toEqual({ total: 4, interviews: 2, followUps: 2 });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- reminders -t "categorizes"`
Expected: FAIL — all buckets empty (Task 2 stub).

- [ ] **Step 3: Implement the bucketing**

Replace the `reminders` function in `src/modules/reminders/reminders.service.js` (drop the `void …` stub line):

```js
async function reminders(userId) {
  const now = new Date();
  const windowEnd = new Date(now.getTime() + WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const [upcomingI, overdueI, dueF, upcomingF] = await Promise.all([
    prisma.interview.findMany({
      where: { userId, scheduledAt: { gte: now, lte: windowEnd } },
      orderBy: { scheduledAt: 'asc' },
      include: interviewInclude,
    }),
    prisma.interview.findMany({
      where: { userId, scheduledAt: { lt: now }, OR: [{ result: null }, { result: 'Pending' }] },
      orderBy: { scheduledAt: 'desc' },
      include: interviewInclude,
    }),
    prisma.contact.findMany({
      where: { userId, followUpDate: { lte: now } },
      orderBy: { followUpDate: 'asc' },
      include: companyInclude,
    }),
    prisma.contact.findMany({
      where: { userId, followUpDate: { gt: now, lte: windowEnd } },
      orderBy: { followUpDate: 'asc' },
      include: companyInclude,
    }),
  ]);

  const interviews = { upcoming: upcomingI.map(shapeInterview), overdue: overdueI.map(shapeInterview) };
  const followUps = { due: dueF.map(shapeFollowUp), upcoming: upcomingF.map(shapeFollowUp) };
  const counts = {
    interviews: interviews.upcoming.length + interviews.overdue.length,
    followUps: followUps.due.length + followUps.upcoming.length,
    total: 0,
  };
  counts.total = counts.interviews + counts.followUps;

  return { interviews, followUps, counts };
}
```

(A `followUpDate` of `null` never satisfies `lte`/`gt` comparisons, so null-date contacts are excluded automatically.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- reminders`
Expected: PASS (empty-shape + auth from Task 2, plus the categorization test).

- [ ] **Step 5: Commit**

```bash
git add src/modules/reminders/reminders.service.js tests/reminders.test.js
git commit -m "feat(reminders): bucket interviews + follow-ups by 7-day window

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Cross-user isolation + full-suite verification

**Files:**
- Test: `tests/reminders.test.js` (append)

**Interfaces:**
- Consumes: `service.reminders(userId)` (final form). No production code change expected.

- [ ] **Step 1: Write the isolation test (append to `tests/reminders.test.js`)**

```js
test('reminders are scoped to the current user', async () => {
  const a = await registerAndLogin();
  const b = await registerAndLogin();

  const appId = (await agent().post('/api/applications').set(auth(a.token))
    .send({ position: 'Theirs' })).body.id;
  await agent().post('/api/interviews').set(auth(a.token))
    .send({ applicationId: appId, type: 'HR', scheduledAt: daysFromNow(2) });
  await agent().post('/api/contacts').set(auth(a.token))
    .send({ name: 'Their Contact', followUpDate: daysFromNow(-1) });

  const res = await agent().get('/api/reminders').set(auth(b.token));
  expect(res.body.counts).toEqual({ total: 0, interviews: 0, followUps: 0 });
  expect(res.body.interviews.upcoming).toHaveLength(0);
  expect(res.body.followUps.due).toHaveLength(0);
});
```

- [ ] **Step 2: Run the reminders tests**

Run: `npm test -- reminders`
Expected: PASS. (User A's data never appears for user B — every query filters by `userId`. If it fails, the bug is a missing `userId` filter; fix the service, don't weaken the test.)

- [ ] **Step 3: Run the full backend suite**

Run: `npm test`
Expected: PASS — the prior 74 tests, plus the contacts null-clear test (Task 1) and 4 reminders tests = **79 total**.

- [ ] **Step 4: Restart the dev server (optional manual smoke)**

```bash
# stop the running server, then:
npm run dev   # node src/server.js, BE on :4000
```

- [ ] **Step 5: Commit**

```bash
git add tests/reminders.test.js
git commit -m "test(reminders): cross-user isolation

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

- **Spec coverage:** `GET /api/reminders` composite endpoint (Task 2) ✓; four buckets with exact filters + ordering (Task 3) ✓; `counts` shape (Tasks 2–3) ✓; null-date exclusion (Task 3) ✓; interview items include `application.position` + `company` (Task 3) ✓; `followUpDate: null` clear via PATCH (Task 1) ✓; auth 401 (Task 2) ✓; empty-user zeros (Task 2) ✓; cross-user isolation (Task 4) ✓; no DB migration ✓.
- **Type consistency:** `service.reminders(userId)` signature, the `interviews`/`followUps`/`counts` shape, and item field names (`{id,type,scheduledAt,result,application}` / `{id,name,position,followUpDate,company}`) are identical across Tasks 2–3 and match the spec response.
- **Placeholders:** none — every step has complete code and exact commands. (Task 2's `void …` line only exists to keep the stub lint-clean; Task 3 removes it.)
