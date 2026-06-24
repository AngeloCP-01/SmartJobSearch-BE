# Activity Log Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an append-only `ActivityLog` (one table) written via a shared `record(...)` helper at curated write points across the applications/interviews/documents/contacts services, plus one filterable, cursor-paginated `GET /api/activity` read endpoint.

**Architecture:** A new self-contained `src/modules/activity/` module owns the log table, the `record` write helper (consumed one-directionally by the other modules), and the read endpoint. `activity.service` depends only on `prisma`, so there is no dependency cycle. Events store denormalized snapshots in a JSON `metadata` column. No new dependencies.

**Tech Stack:** Express, Prisma (PostgreSQL), Jest + Supertest.

## Global Constraints

- Every service function takes `userId` and filters **every** query by it (hard per-user isolation).
- JWT-protected: the router applies `requireAuth` (`req.userId` set by middleware); controllers `next(e)` on error.
- `ActivityAction` enum values (exact): `ApplicationCreated`, `ApplicationStatusChanged`, `ApplicationDeleted`, `InterviewScheduled`, `InterviewResultRecorded`, `DocumentLinked`, `ContactLinked`.
- `record(userId, action, { applicationId = null, metadata = {} })` is `await`ed in-request after the entity write; a failed log fails the action.
- Logging rules: status change logs **only when the status actually changes**; `InterviewResultRecorded` logs **only when `result` transitions to `Passed` or `Failed`** (not on a notes-only edit, not on `Pending`); `ApplicationDeleted` is logged with `applicationId: null` and a `position` snapshot.
- `metadata` always includes `position` (the application's position title) so the global feed can name the application; plus per-action fields: status `{from,to}`, interview `{type,scheduledAt}` / `{type,result}`, link `{name}`.
- Read: `GET /api/activity` → `{ items, nextCursor }`, newest-first; params `applicationId`, `limit` (default 50, clamp 1–100), `before` (ISO `createdAt`, returns strictly older). `nextCursor` is the last item's `createdAt` ISO string when the page is full, else `null`.
- `ActivityItem` shape returned to clients: `{ id, action, applicationId, metadata, createdAt }` (no `userId`).
- Tests use the existing harness: `tests/helpers/testApp.js` (`agent`), `tests/helpers/db.js` (`prisma`, `resetDb`), `tests/helpers/auth.js` (`registerAndLogin`). Run the DB first: `docker compose up -d`; `npm test` runs `jest --runInBand` + `prisma migrate deploy` via global setup.
- After backend changes, restart the dev server (`npm run dev` = plain `node src/server.js`, no auto-reload).
- Commit trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

### Task 1: Migration + activity module + ApplicationCreated logging

Establishes the table, the `record` helper, the read endpoint, and the first call site (so the slice is testable end-to-end).

**Files:**
- Modify: `prisma/schema.prisma`
- Create: migration (via `prisma migrate dev`)
- Modify: `tests/helpers/db.js`
- Create: `src/modules/activity/activity.service.js`
- Create: `src/modules/activity/activity.controller.js`
- Create: `src/modules/activity/activity.routes.js`
- Modify: `src/routes/index.js`
- Modify: `src/modules/applications/applications.service.js`
- Test: `tests/activity.test.js`

**Interfaces:**
- Produces: `activity.record(userId, action, { applicationId, metadata }) → Promise<void>`; `activity.list(userId, { applicationId, limit, before }) → Promise<{ items, nextCursor }>`.

- [ ] **Step 1: Add the model + enum to `prisma/schema.prisma`**

Add the enum next to the existing enums:

```prisma
enum ActivityAction {
  ApplicationCreated
  ApplicationStatusChanged
  ApplicationDeleted
  InterviewScheduled
  InterviewResultRecorded
  DocumentLinked
  ContactLinked
}
```

Add the model (after the `ApplicationDocument` model):

```prisma
model ActivityLog {
  id            String         @id @default(uuid())
  userId        String
  user          User           @relation(fields: [userId], references: [id], onDelete: Cascade)
  action        ActivityAction
  applicationId String?
  application   Application?   @relation(fields: [applicationId], references: [id], onDelete: SetNull)
  metadata      Json           @default("{}")
  createdAt     DateTime       @default(now())

  @@index([userId, createdAt])
  @@index([applicationId])
}
```

Add back-relations:
- In `model User { … }`, alongside `documents Document[]`: `activityLogs ActivityLog[]`
- In `model Application { … }`, alongside `documentLinks ApplicationDocument[]`: `activityLogs ActivityLog[]`

- [ ] **Step 2: Create the migration + regenerate**

```bash
docker compose up -d
npx prisma migrate dev --name add_activity_log
npx prisma generate
```
Expected: a new `…_add_activity_log` migration is created and applied.

- [ ] **Step 3: Update `resetDb`**

In `tests/helpers/db.js`, add `activityLog` cleanup before `application`/`user` (it references both):

```js
  await prisma.applicationContact.deleteMany();
  await prisma.applicationDocument.deleteMany();
  await prisma.activityLog.deleteMany();
  await prisma.interview.deleteMany();
```

- [ ] **Step 4: Write the failing test**

Create `tests/activity.test.js`:

```js
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
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `npm test -- activity`
Expected: FAIL — `404` (route not wired).

- [ ] **Step 6: Create the service**

Create `src/modules/activity/activity.service.js`:

```js
const prisma = require('../../shared/database/prisma');

const selectItem = { id: true, action: true, applicationId: true, metadata: true, createdAt: true };

async function record(userId, action, { applicationId = null, metadata = {} } = {}) {
  await prisma.activityLog.create({ data: { userId, action, applicationId, metadata } });
}

async function list(userId, { applicationId, limit, before } = {}) {
  const take = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 100);
  const items = await prisma.activityLog.findMany({
    where: {
      userId,
      ...(applicationId ? { applicationId } : {}),
      ...(before ? { createdAt: { lt: new Date(before) } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take,
    select: selectItem,
  });
  const nextCursor = items.length === take ? items[items.length - 1].createdAt.toISOString() : null;
  return { items, nextCursor };
}

module.exports = { record, list };
```

- [ ] **Step 7: Create the controller**

Create `src/modules/activity/activity.controller.js`:

```js
const service = require('./activity.service');

async function list(req, res, next) {
  try {
    res.json(await service.list(req.userId, {
      applicationId: req.query.applicationId,
      limit: req.query.limit,
      before: req.query.before,
    }));
  } catch (e) { next(e); }
}

module.exports = { list };
```

- [ ] **Step 8: Create the routes**

Create `src/modules/activity/activity.routes.js`:

```js
const { Router } = require('express');
const { requireAuth } = require('../../shared/middleware/auth');
const ctrl = require('./activity.controller');

const router = Router();
router.use(requireAuth);

router.get('/', ctrl.list);

module.exports = router;
```

- [ ] **Step 9: Wire the module**

In `src/routes/index.js`, add alongside the others and mount after `documents`:

```js
const activityRoutes = require('../modules/activity/activity.routes');
```
```js
router.use('/activity', activityRoutes);
```

- [ ] **Step 10: Log `ApplicationCreated` in `applications.service.create`**

In `src/modules/applications/applications.service.js`, require the helper near the top (after the existing requires):

```js
const activity = require('../activity/activity.service');
```

Replace `create`:

```js
async function create(userId, data) {
  await assertCompany(userId, data.companyId);
  const app = await prisma.application.create({ data: { ...data, userId }, include: includeCompany });
  await activity.record(userId, 'ApplicationCreated', { applicationId: app.id, metadata: { position: app.position } });
  return app;
}
```

- [ ] **Step 11: Run the tests to verify they pass**

Run: `npm test -- activity`
Expected: PASS (4 tests).

- [ ] **Step 12: Commit**

```bash
git add prisma/schema.prisma prisma/migrations tests/helpers/db.js src/modules/activity src/routes/index.js src/modules/applications/applications.service.js tests/activity.test.js
git commit -m "feat(activity): ActivityLog model + GET /api/activity + ApplicationCreated logging

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Status-change + delete logging

**Files:**
- Modify: `src/modules/applications/applications.service.js`
- Test: `tests/activity.test.js` (append)

**Interfaces:**
- Consumes: `activity.record` (Task 1); `getById` returns the application (with `status`, `position`).

- [ ] **Step 1: Write the failing tests (append to `tests/activity.test.js`)**

```js
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- activity -t "status\|Deleted"`
Expected: FAIL — no status/delete events logged yet.

- [ ] **Step 3: Implement the logging**

In `src/modules/applications/applications.service.js`, replace `updateStatus` and `remove`:

```js
async function updateStatus(userId, id, status) {
  const existing = await getById(userId, id);
  const app = await prisma.application.update({ where: { id }, data: { status }, include: includeCompany });
  if (existing.status !== status) {
    await activity.record(userId, 'ApplicationStatusChanged', {
      applicationId: id,
      metadata: { position: app.position, from: existing.status, to: status },
    });
  }
  return app;
}

async function remove(userId, id) {
  const existing = await getById(userId, id);
  await prisma.application.delete({ where: { id } });
  await activity.record(userId, 'ApplicationDeleted', { applicationId: null, metadata: { position: existing.position } });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- activity`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/applications/applications.service.js tests/activity.test.js
git commit -m "feat(activity): log application status changes + deletions

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Interview logging (scheduled + result recorded)

**Files:**
- Modify: `src/modules/interviews/interviews.service.js`
- Test: `tests/activity.test.js` (append)

**Interfaces:**
- Consumes: `activity.record` (Task 1). `getById` returns the interview (with `result`, `type`, `applicationId`).

- [ ] **Step 1: Write the failing tests (append to `tests/activity.test.js`)**

```js
test('scheduling an interview logs InterviewScheduled', async () => {
  const { token } = await registerAndLogin();
  const app = await makeApp(token, 'Eng');
  await agent().post('/api/interviews').set(auth(token)).send({ applicationId: app.id, type: 'Technical' });
  const res = await agent().get(`/api/activity?applicationId=${app.id}`).set(auth(token));
  const ev = res.body.items.find((i) => i.action === 'InterviewScheduled');
  expect(ev).toBeTruthy();
  expect(ev.metadata).toMatchObject({ position: 'Eng', type: 'Technical' });
});

test('recording a Passed/Failed result logs InterviewResultRecorded; a notes edit does not', async () => {
  const { token } = await registerAndLogin();
  const app = await makeApp(token, 'Eng');
  const iv = (await agent().post('/api/interviews').set(auth(token)).send({ applicationId: app.id, type: 'HR' })).body;

  await agent().patch(`/api/interviews/${iv.id}`).set(auth(token)).send({ notes: 'went ok' });
  let res = await agent().get(`/api/activity?applicationId=${app.id}`).set(auth(token));
  expect(res.body.items.filter((i) => i.action === 'InterviewResultRecorded')).toHaveLength(0);

  await agent().patch(`/api/interviews/${iv.id}`).set(auth(token)).send({ result: 'Passed' });
  res = await agent().get(`/api/activity?applicationId=${app.id}`).set(auth(token));
  const ev = res.body.items.find((i) => i.action === 'InterviewResultRecorded');
  expect(ev).toBeTruthy();
  expect(ev.metadata).toMatchObject({ position: 'Eng', type: 'HR', result: 'Passed' });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- activity -t "interview\|Interview"`
Expected: FAIL — no interview events logged yet.

- [ ] **Step 3: Implement the logging**

In `src/modules/interviews/interviews.service.js`, require the helper near the top:

```js
const activity = require('../activity/activity.service');
```

Add a small helper and update `create`/`update`:

```js
async function positionOf(userId, applicationId) {
  const app = await prisma.application.findFirst({ where: { id: applicationId, userId }, select: { position: true } });
  return app?.position;
}

async function create(userId, data) {
  await assertApplication(userId, data.applicationId);
  const interview = await prisma.interview.create({ data: { ...data, userId } });
  await activity.record(userId, 'InterviewScheduled', {
    applicationId: interview.applicationId,
    metadata: { position: await positionOf(userId, interview.applicationId), type: interview.type, scheduledAt: interview.scheduledAt },
  });
  return interview;
}

async function update(userId, id, data) {
  const existing = await getById(userId, id);
  await assertApplication(userId, data.applicationId);
  const interview = await prisma.interview.update({ where: { id }, data });
  if (data.result && data.result !== existing.result && (data.result === 'Passed' || data.result === 'Failed')) {
    await activity.record(userId, 'InterviewResultRecorded', {
      applicationId: interview.applicationId,
      metadata: { position: await positionOf(userId, interview.applicationId), type: interview.type, result: data.result },
    });
  }
  return interview;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- activity`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/interviews/interviews.service.js tests/activity.test.js
git commit -m "feat(activity): log interviews scheduled + results recorded

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Link logging + filtering/pagination + full suite

**Files:**
- Modify: `src/modules/documents/documents.service.js`
- Modify: `src/modules/contacts/contacts.service.js`
- Test: `tests/activity.test.js` (append)

**Interfaces:**
- Consumes: `activity.record` (Task 1). In both services `assertApplication` returns the app (with `position`); `assertDocument`/`assertContact` return the entity (with `name`).

- [ ] **Step 1: Write the failing tests (append to `tests/activity.test.js`)**

```js
test('linking a document logs DocumentLinked, and a contact logs ContactLinked', async () => {
  const { token } = await registerAndLogin();
  const app = await makeApp(token, 'Eng');
  const docId = (await agent().post('/api/documents').set(auth(token))
    .field('name', 'Resume v2').field('type', 'Resume')
    .attach('file', Buffer.from('%PDF-1.4'), { filename: 'r.pdf', contentType: 'application/pdf' })).body.id;
  const contactId = (await agent().post('/api/contacts').set(auth(token)).send({ name: 'Jane Recruiter' })).body.id;

  await agent().post(`/api/applications/${app.id}/documents`).set(auth(token)).send({ documentId: docId });
  await agent().post(`/api/applications/${app.id}/contacts`).set(auth(token)).send({ contactId });

  const res = await agent().get(`/api/activity?applicationId=${app.id}`).set(auth(token));
  const doc = res.body.items.find((i) => i.action === 'DocumentLinked');
  const contact = res.body.items.find((i) => i.action === 'ContactLinked');
  expect(doc.metadata).toMatchObject({ position: 'Eng', name: 'Resume v2' });
  expect(contact.metadata).toMatchObject({ position: 'Eng', name: 'Jane Recruiter' });
});

test('filters by applicationId and paginates with limit/before', async () => {
  const { token } = await registerAndLogin();
  const app = await makeApp(token, 'Eng');
  // produces a sequence of events (created + 3 status changes)
  for (const status of ['Applied', 'HR_Screening', 'Technical_Interview']) {
    await agent().patch(`/api/applications/${app.id}/status`).set(auth(token)).send({ status });
  }
  const other = await makeApp(token, 'Other');

  const onlyThis = await agent().get(`/api/activity?applicationId=${app.id}`).set(auth(token));
  expect(onlyThis.body.items.every((i) => i.applicationId === app.id)).toBe(true);
  expect(onlyThis.body.items.some((i) => i.metadata.position === 'Other')).toBe(false);

  const page1 = await agent().get('/api/activity?limit=2').set(auth(token));
  expect(page1.body.items).toHaveLength(2);
  expect(page1.body.nextCursor).not.toBeNull();
  const page2 = await agent().get(`/api/activity?limit=2&before=${encodeURIComponent(page1.body.nextCursor)}`).set(auth(token));
  expect(page2.body.items.length).toBeGreaterThan(0);
  // strictly older than page 1's last item
  expect(new Date(page2.body.items[0].createdAt) <= new Date(page1.body.nextCursor)).toBe(true);
  void other;
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- activity -t "Linked\|paginates"`
Expected: FAIL — no link events logged (the pagination test may also depend on link/other events but primarily on link logging being absent).

- [ ] **Step 3: Log `DocumentLinked`**

In `src/modules/documents/documents.service.js`, require the helper near the top:

```js
const activity = require('../activity/activity.service');
```

In `linkApplication`, capture the asserted app/doc and record after the join is created:

```js
async function linkApplication(userId, applicationId, documentId) {
  const app = await assertApplication(userId, applicationId);
  const doc = await assertDocument(userId, documentId);
  const existing = await prisma.applicationDocument.findUnique({
    where: { applicationId_documentId: { applicationId, documentId } },
  });
  if (existing) throw new ConflictError('Document already linked to this application');
  await prisma.applicationDocument.create({ data: { applicationId, documentId } });
  await activity.record(userId, 'DocumentLinked', { applicationId, metadata: { position: app.position, name: doc.name } });
  return prisma.document.findFirst({ where: { id: documentId }, select: publicSelect });
}
```

- [ ] **Step 4: Log `ContactLinked`**

In `src/modules/contacts/contacts.service.js`, require the helper near the top:

```js
const activity = require('../activity/activity.service');
```

In `linkApplication`, capture the asserted app/contact and record after the join is created:

```js
async function linkApplication(userId, applicationId, contactId) {
  const app = await assertApplication(userId, applicationId);
  const contact = await assertContact(userId, contactId);
  const existing = await prisma.applicationContact.findUnique({
    where: { applicationId_contactId: { applicationId, contactId } },
  });
  if (existing) throw new ConflictError('Contact already linked to this application');
  await prisma.applicationContact.create({ data: { applicationId, contactId } });
  await activity.record(userId, 'ContactLinked', { applicationId, metadata: { position: app.position, name: contact.name } });
  return prisma.contact.findFirst({ where: { id: contactId }, include: includeCompany });
}
```

- [ ] **Step 5: Run the activity tests**

Run: `npm test -- activity`
Expected: PASS (11 tests).

- [ ] **Step 6: Run the full backend suite**

Run: `npm test`
Expected: PASS — the prior 97 tests plus 11 activity tests = **108 total**.

- [ ] **Step 7: Commit**

```bash
git add src/modules/documents/documents.service.js src/modules/contacts/contacts.service.js tests/activity.test.js
git commit -m "feat(activity): log document/contact links + verify filtering/pagination

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

- **Spec coverage:** `ActivityLog` model + enum + migration (Task 1) ✓; `record` helper + read endpoint `{items,nextCursor}` (Task 1) ✓; all 7 call sites — ApplicationCreated (T1), StatusChanged+Deleted (T2), InterviewScheduled+ResultRecorded (T3), DocumentLinked+ContactLinked (T4) ✓; "only on real transition" rules for status (T2) and result (T3) ✓; ApplicationDeleted with `applicationId: null` + snapshot (T2) ✓; `applicationId` filter + `limit`/`before`/`nextCursor` pagination (T1 service, T4 test) ✓; cross-user isolation (T1) ✓; `userId` never returned (T1 `selectItem`) ✓; `metadata` snapshots incl. `position` (all tasks) ✓.
- **Type consistency:** `record(userId, action, { applicationId, metadata })` and the `ActivityItem` shape (`{id,action,applicationId,metadata,createdAt}`) are consistent across tasks; action strings match the `ActivityAction` enum exactly; `positionOf` (T3) is the only added helper and is self-contained.
- **Placeholders:** none — every step has complete code and exact commands.
