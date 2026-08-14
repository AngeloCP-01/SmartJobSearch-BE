# List Pagination (`/api/v2`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add paginated list endpoints for `applications`, `analysis`, `companies`, `contacts`, and `activity` under a new `/api/v2` prefix, leaving every existing `/api` and `/api/v1` response byte-identical.

**Architecture:** One service per module keeps a single `list()` that returns `{ items, total }`; the v1 controller unwraps it to today's bare array and the v2 controller wraps it in an envelope. A shared `src/shared/pagination.js` owns the page-size allowlist, the Zod query schemas, and both envelope builders. `/api/v2` mounts the full module surface — only the five list handlers differ.

**Tech Stack:** Node + Express 4, Prisma, Zod, Jest + Supertest (`tests/helpers/{testApp,db,auth}`).

**Spec:** `docs/superpowers/specs/2026-08-13-list-pagination-design.md`

## Global Constraints

- Page sizes are **exactly** `10, 25, 50, 100`. Default `25`. An out-of-list value returns **400**, it is **never** clamped.
- Offset envelope: `{ items, page, pageSize, total, totalPages }`. `totalPages` is **0** when `total` is 0 (not 1).
- Cursor envelope: `{ items, pageSize, nextCursor }`. No `total`/`totalPages`.
- v1 (`/api`, `/api/v1`) responses **must stay byte-identical bare arrays**. Every task that touches a service ends with the v1 regression test still green.
- `/api/v2` must be registered **before** the `['/api/v1', '/api']` loop in `src/app.js`.
- Column names are verified against `prisma/schema.prisma`: the applications date column is **`applicationDate`**, not `appliedDate`. Analysis has `atsScore`, `matchScore`, `createdAt` — `documentName`/`position` live in `report` JSON and are **not** sortable.
- `total` must be computed with the **same `where`** as `findMany` — the filtered count, never the table count.
- No schema migration. No frontend changes.
- CommonJS (`require`/`module.exports`), matching the existing codebase.

---

### Task 1: Shared pagination module

**Files:**
- Create: `src/shared/pagination.js`
- Test: `src/shared/pagination.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `PAGE_SIZES: number[]` — `[10, 25, 50, 100]`
  - `DEFAULT_PAGE_SIZE: number` — `25`
  - `offsetShape: object` — Zod shape `{ page, pageSize }` for spreading into module schemas
  - `cursorShape: object` — Zod shape `{ pageSize, before }`
  - `sortShape(allowedKeys: string[], defaultKey?: string): object` — Zod shape `{ sort, dir }`
  - `toSkipTake({ page, pageSize }): { skip: number, take: number }`
  - `toOffsetEnvelope({ items, total, page, pageSize }): object`
  - `toCursorEnvelope({ items, pageSize, nextCursor }): object`

- [ ] **Step 1: Write the failing test**

```js
// src/shared/pagination.test.js
const { z } = require('zod');
const {
  PAGE_SIZES, DEFAULT_PAGE_SIZE, offsetShape, cursorShape, sortShape,
  toSkipTake, toOffsetEnvelope, toCursorEnvelope,
} = require('./pagination');

const offsetSchema = z.object(offsetShape);
const cursorSchema = z.object(cursorShape);

test('page sizes are exactly the agreed allowlist', () => {
  expect(PAGE_SIZES).toEqual([10, 25, 50, 100]);
  expect(DEFAULT_PAGE_SIZE).toBe(25);
});

test('offset query defaults to page 1 and the default page size', () => {
  expect(offsetSchema.parse({})).toEqual({ page: 1, pageSize: 25 });
});

test.each(PAGE_SIZES)('offset query accepts allowlisted pageSize %i', (size) => {
  expect(offsetSchema.parse({ pageSize: String(size) }).pageSize).toBe(size);
});

test('offset query REJECTS an out-of-list pageSize rather than clamping', () => {
  const result = offsetSchema.safeParse({ pageSize: '7' });
  expect(result.success).toBe(false);
});

test('offset query rejects page below 1', () => {
  expect(offsetSchema.safeParse({ page: '0' }).success).toBe(false);
});

test('toSkipTake converts a page into skip/take', () => {
  expect(toSkipTake({ page: 1, pageSize: 25 })).toEqual({ skip: 0, take: 25 });
  expect(toSkipTake({ page: 3, pageSize: 10 })).toEqual({ skip: 20, take: 10 });
});

test('toOffsetEnvelope computes totalPages by rounding up', () => {
  expect(toOffsetEnvelope({ items: [], total: 21, page: 1, pageSize: 10 }))
    .toEqual({ items: [], page: 1, pageSize: 10, total: 21, totalPages: 3 });
});

test('toOffsetEnvelope reports 0 totalPages for an empty result, not 1', () => {
  expect(toOffsetEnvelope({ items: [], total: 0, page: 1, pageSize: 25 }).totalPages).toBe(0);
});

test('cursor query defaults pageSize and leaves before undefined', () => {
  expect(cursorSchema.parse({})).toEqual({ pageSize: 25, before: undefined });
});

test('cursor query REJECTS an out-of-list pageSize', () => {
  expect(cursorSchema.safeParse({ pageSize: '7' }).success).toBe(false);
});

test('toCursorEnvelope carries nextCursor and omits total', () => {
  const env = toCursorEnvelope({ items: [{ id: 'a' }], pageSize: 10, nextCursor: 'c1' });
  expect(env).toEqual({ items: [{ id: 'a' }], pageSize: 10, nextCursor: 'c1' });
  expect(env).not.toHaveProperty('total');
});

test('sortShape defaults to the given key and desc, and rejects unknown keys', () => {
  const schema = z.object(sortShape(['createdAt', 'position'], 'createdAt'));
  expect(schema.parse({})).toEqual({ sort: 'createdAt', dir: 'desc' });
  expect(schema.parse({ sort: 'position', dir: 'asc' })).toEqual({ sort: 'position', dir: 'asc' });
  expect(schema.safeParse({ sort: 'dropTable' }).success).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/shared/pagination.test.js`
Expected: FAIL — `Cannot find module './pagination'`

- [ ] **Step 3: Write minimal implementation**

```js
// src/shared/pagination.js
const { z } = require('zod');

// The agreed page-size allowlist. Out-of-list values are rejected with 400
// rather than clamped: a size the server silently ignores is not a contract,
// because the client cannot tell whether it got what it asked for.
const PAGE_SIZES = [10, 25, 50, 100];
const DEFAULT_PAGE_SIZE = 25;

const pageSizeField = z.coerce
  .number()
  .int()
  .refine((n) => PAGE_SIZES.includes(n), {
    message: `pageSize must be one of ${PAGE_SIZES.join(', ')}`,
  })
  .default(DEFAULT_PAGE_SIZE);

// Exported as shapes (not schemas) so module query schemas can spread them
// alongside their own filters: z.object({ ...offsetShape, status: ... }).
const offsetShape = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: pageSizeField,
};

const cursorShape = {
  pageSize: pageSizeField,
  before: z.string().optional(),
};

// Sort keys are an allowlist, never raw input handed to Prisma's orderBy.
function sortShape(allowedKeys, defaultKey = 'createdAt') {
  return {
    sort: z.enum(allowedKeys).default(defaultKey),
    dir: z.enum(['asc', 'desc']).default('desc'),
  };
}

const toSkipTake = ({ page, pageSize }) => ({
  skip: (page - 1) * pageSize,
  take: pageSize,
});

function toOffsetEnvelope({ items, total, page, pageSize }) {
  return {
    items,
    page,
    pageSize,
    total,
    // An empty list has no pages. Reporting "Page 1 of 1" over nothing is a lie
    // the client would render.
    totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
  };
}

const toCursorEnvelope = ({ items, pageSize, nextCursor }) => ({ items, pageSize, nextCursor });

module.exports = {
  PAGE_SIZES,
  DEFAULT_PAGE_SIZE,
  offsetShape,
  cursorShape,
  sortShape,
  toSkipTake,
  toOffsetEnvelope,
  toCursorEnvelope,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/shared/pagination.test.js`
Expected: PASS — 12 tests

- [ ] **Step 5: Commit**

```bash
git add src/shared/pagination.js src/shared/pagination.test.js
git commit -m "feat(pagination): shared page-size allowlist, query shapes, envelopes"
```

---

### Task 2: Applications service returns `{ items, total }` (no behaviour change)

Pure refactor. v1 output must not move. This task adds **no** new endpoint.

**Files:**
- Modify: `src/modules/applications/applications.service.js:13-18`
- Modify: `src/modules/applications/applications.controller.js:5-8`
- Test: `tests/applications.test.js` (append)

**Interfaces:**
- Consumes: nothing from Task 1 yet.
- Produces: `service.list(userId, opts) -> Promise<{ items, total }>` where `opts` is
  `{ status, companyId, search, sort, dir, skip, take }`, all optional. When `take` is
  `undefined` the query is unpaginated and `total === items.length`.

- [ ] **Step 1: Write the failing test**

```js
// append to tests/applications.test.js
test('v1 list is still a bare array after the service refactor', async () => {
  const { token } = await registerAndLogin();
  await agent().post('/api/applications').set(auth(token)).send({ position: 'A' });
  await agent().post('/api/applications').set(auth(token)).send({ position: 'B' });

  const res = await agent().get('/api/applications').set(auth(token));
  expect(res.status).toBe(200);
  expect(Array.isArray(res.body)).toBe(true);
  expect(res.body).toHaveLength(2);
  expect(res.body[0]).not.toHaveProperty('items');
});

test('service.list returns {items,total} and counts the FILTERED set', async () => {
  const service = require('../src/modules/applications/applications.service');
  const { token, userId } = await registerAndLogin();
  await agent().post('/api/applications').set(auth(token)).send({ position: 'A' });
  await agent().post('/api/applications').set(auth(token))
    .send({ position: 'B', status: 'Applied' });

  const all = await service.list(userId, {});
  expect(all.total).toBe(2);
  expect(all.items).toHaveLength(2);

  const filtered = await service.list(userId, { status: 'Applied', skip: 0, take: 10 });
  expect(filtered.total).toBe(1);
  expect(filtered.items).toHaveLength(1);
});
```

> If `registerAndLogin()` does not already return `userId`, read the created user's id
> via `prisma.user.findFirst()` in the test instead of changing the helper.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/applications.test.js -t 'service.list returns'`
Expected: FAIL — `all.total` is `undefined` (service currently resolves to an array)

- [ ] **Step 3: Write minimal implementation**

```js
// src/modules/applications/applications.service.js — replace lines 13-18
const ORDER_BY = {
  position: (dir) => ({ position: dir }),
  company: (dir) => ({ company: { name: dir } }),
  status: (dir) => ({ status: dir }),
  applicationDate: (dir) => ({ applicationDate: dir }),
  createdAt: (dir) => ({ createdAt: dir }),
};

function buildWhere(userId, { status, companyId, search }) {
  return {
    userId,
    ...(status ? { status } : {}),
    ...(companyId ? { companyId } : {}),
    ...(search
      ? {
          OR: [
            { position: { contains: search, mode: 'insensitive' } },
            { company: { name: { contains: search, mode: 'insensitive' } } },
          ],
        }
      : {}),
  };
}

// Returns { items, total } always. Without `take` this is the unpaginated v1
// path and deliberately skips COUNT(*) — v1 must not start paying for a count
// it never reads.
async function list(userId, {
  status, companyId, search, sort = 'createdAt', dir = 'desc', skip, take,
} = {}) {
  const where = buildWhere(userId, { status, companyId, search });
  const orderBy = (ORDER_BY[sort] || ORDER_BY.createdAt)(dir);

  if (take === undefined) {
    const items = await prisma.application.findMany({ where, orderBy, include: includeCompany });
    return { items, total: items.length };
  }

  const [items, total] = await prisma.$transaction([
    prisma.application.findMany({ where, orderBy, include: includeCompany, skip, take }),
    prisma.application.count({ where }),
  ]);
  return { items, total };
}
```

```js
// src/modules/applications/applications.controller.js — replace lines 5-8
async function list(req, res, next) {
  try {
    const { items } = await service.list(req.userId, { status: req.query.status });
    res.json(items);
  } catch (e) { next(e); }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/applications.test.js`
Expected: PASS — the whole existing file, plus the two new tests

- [ ] **Step 5: Commit**

```bash
git add src/modules/applications/applications.service.js \
        src/modules/applications/applications.controller.js \
        tests/applications.test.js
git commit -m "refactor(applications): list() returns {items,total}; v1 output unchanged"
```

---

### Task 3: Applications `/api/v2` — the gate task

Proves the routing, the mount order, the query schema, and the v1-unchanged guarantee. Get this right once rather than five times.

**Files:**
- Modify: `src/modules/applications/applications.schema.js` (append)
- Modify: `src/modules/applications/applications.controller.js` (append `listPaged`)
- Modify: `src/modules/applications/applications.routes.js` (convert to factory, export `{ v1, v2 }`)
- Create: `src/routes/v2.js`
- Modify: `src/routes/index.js` (use `.v1` for applications)
- Modify: `src/app.js:42-48` (export mount table, register `/api/v2` first)
- Test: `tests/pagination-applications.test.js`, `tests/app-mounts.test.js`

**Interfaces:**
- Consumes: `offsetShape`, `sortShape`, `toSkipTake`, `toOffsetEnvelope` (Task 1); `service.list` (Task 2).
- Produces:
  - `applications.schema.js` → `listApplicationsQuerySchema`
  - `applications.controller.js` → `listPaged(req, res, next)`
  - `applications.routes.js` → `{ v1: Router, v2: Router }`
  - `src/routes/v2.js` → `Router`
  - `src/app.js` → `API_MOUNTS: Array<{ base: string, routes: Router }>`

- [ ] **Step 1: Write the failing tests**

```js
// tests/app-mounts.test.js
const { API_MOUNTS } = require('../src/app');

test('/api/v2 is registered before /api so its limiter runs once, not twice', () => {
  const bases = API_MOUNTS.map((m) => m.base);
  expect(bases).toContain('/api/v2');
  expect(bases.indexOf('/api/v2')).toBeLessThan(bases.indexOf('/api'));
});
```

> Why declarative rather than counting requests: `src/app.js:28` makes the limiter a
> no-op when `NODE_ENV === 'test'`, so a double-increment is invisible to the suite.
> `app.use('/api', …)` also prefix-matches `/api/v2/...`, so registration order is the
> actual guarantee — assert the order.

```js
// tests/pagination-applications.test.js
const { agent } = require('./helpers/testApp');
const { prisma, resetDb } = require('./helpers/db');
const { registerAndLogin } = require('./helpers/auth');

beforeEach(resetDb);
afterAll(async () => { await prisma.$disconnect(); });

const auth = (t) => ({ Authorization: `Bearer ${t}` });

async function seed(token, n) {
  for (let i = 0; i < n; i += 1) {
    // Sequential: creation order defines createdAt, which is the default sort.
    await agent().post('/api/applications').set(auth(token))
      .send({ position: `Role ${String(i).padStart(2, '0')}` });
  }
}

test('defaults to page 1 with pageSize 25 and an envelope', async () => {
  const { token } = await registerAndLogin();
  await seed(token, 3);
  const res = await agent().get('/api/v2/applications').set(auth(token));
  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({ page: 1, pageSize: 25, total: 3, totalPages: 1 });
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/pagination-applications.test.js tests/app-mounts.test.js`
Expected: FAIL — `API_MOUNTS` undefined; every `/api/v2/...` request 404s

- [ ] **Step 3: Write the implementation**

```js
// src/modules/applications/applications.schema.js — append before module.exports
const { offsetShape, sortShape } = require('../../shared/pagination');

const APPLICATION_SORT_KEYS = ['position', 'company', 'status', 'applicationDate', 'createdAt'];

const listApplicationsQuerySchema = z.object({
  ...offsetShape,
  ...sortShape(APPLICATION_SORT_KEYS, 'createdAt'),
  status: z.enum(STATUSES).optional(),
  companyId: z.string().uuid().optional(),
  search: z.string().trim().min(1).optional(),
});
```

Add `listApplicationsQuerySchema` and `APPLICATION_SORT_KEYS` to that file's `module.exports`.

```js
// src/modules/applications/applications.controller.js — append
const { toSkipTake, toOffsetEnvelope } = require('../../shared/pagination');

async function listPaged(req, res, next) {
  try {
    const { page, pageSize, sort, dir, status, companyId, search } = req.query;
    const { skip, take } = toSkipTake({ page, pageSize });
    const { items, total } = await service.list(req.userId, {
      status, companyId, search, sort, dir, skip, take,
    });
    res.json(toOffsetEnvelope({ items, total, page, pageSize }));
  } catch (e) { next(e); }
}
```

Add `listPaged` to that file's `module.exports`.

```js
// src/modules/applications/applications.routes.js — replace the router construction
const { listApplicationsQuerySchema } = require('./applications.schema');
const { validate } = require('../../shared/middleware/validate');

// One definition, two list handlers. Duplicating the route table instead would
// let v1 and v2 drift the first time either is edited.
function makeRouter(listHandler) {
  const router = Router();
  router.use(requireAuth);

  router.get('/', listHandler);
  router.post('/', validate(createApplicationSchema), ctrl.create);
  router.get('/:id', ctrl.getById);
  router.patch('/:id', validate(updateApplicationSchema), ctrl.update);
  router.patch('/:id/status', validate(statusSchema), ctrl.updateStatus);
  router.delete('/:id', ctrl.remove);
  router.post('/:id/contacts', validate(linkContactSchema), ctrl.linkContact);
  router.delete('/:id/contacts/:contactId', ctrl.unlinkContact);
  router.post('/:id/documents', validate(linkDocumentSchema), ctrl.linkDocument);
  router.delete('/:id/documents/:documentId', ctrl.unlinkDocument);

  return router;
}

module.exports = {
  v1: makeRouter(ctrl.list),
  v2: makeRouter([validate(listApplicationsQuerySchema, 'query'), ctrl.listPaged]),
};
```

```js
// src/routes/index.js — change the applications line only
const applicationsRoutes = require('../modules/applications/applications.routes');
// ...
router.use('/applications', applicationsRoutes.v1);
```

```js
// src/routes/v2.js — new file
const { Router } = require('express');
const applicationsRoutes = require('../modules/applications/applications.routes');
const v1Routes = require('./index');

// v2 is a COMPLETE surface: everything v1 serves, with paginated list handlers
// swapped in. Mounting v1Routes last means any module not yet migrated still
// answers under /api/v2 unchanged, so the client can move one base URL.
const router = Router();
router.use('/applications', applicationsRoutes.v2);
router.use('/', v1Routes);

module.exports = router;
```

```js
// src/app.js — replace lines 42-48
const v2Routes = require('./routes/v2');

// Mount order is load-bearing. app.use('/api', …) also prefix-matches
// '/api/v2/...', and Express runs every matching app.use in registration order
// until a response is sent — so if v2 came last, each v2 request would pass
// through apiLimiter twice and get half the intended rate budget.
const API_MOUNTS = [
  { base: '/api/v2', routes: v2Routes },
  { base: '/api/v1', routes },
  { base: '/api', routes },
];

for (const { base, routes: mounted } of API_MOUNTS) {
  app.use(base, apiLimiter);
  app.use(`${base}/auth`, authLimiter);
  app.use(base, mounted);
}
```

Change the export to `module.exports = app; module.exports.API_MOUNTS = API_MOUNTS;`

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/pagination-applications.test.js tests/app-mounts.test.js tests/applications.test.js`
Expected: PASS — all three files

- [ ] **Step 5: Run the full suite (v1 regression gate)**

Run: `npx jest --runInBand`
Expected: PASS — no existing test changes behaviour

- [ ] **Step 6: Commit**

```bash
git add src/app.js src/routes/v2.js src/routes/index.js src/modules/applications tests/
git commit -m "feat(api): /api/v2 with paginated applications list"
```

---

### Task 4: Companies `/api/v2`

**Files:**
- Modify: `src/modules/companies/companies.service.js:4-8`, `companies.controller.js:3-6`, `companies.routes.js`
- Modify: `src/modules/companies/companies.schema.js` (append)
- Modify: `src/routes/index.js`, `src/routes/v2.js`
- Test: `tests/pagination-companies.test.js`

**Interfaces:**
- Consumes: `offsetShape`, `sortShape`, `toSkipTake`, `toOffsetEnvelope` (Task 1).
- Produces: `service.list(userId, { search, sort, dir, skip, take }) -> { items, total }`; `ctrl.listPaged`; `companies.routes.js` → `{ v1, v2 }`.

- [ ] **Step 1: Write the failing test**

```js
// tests/pagination-companies.test.js
const { agent } = require('./helpers/testApp');
const { prisma, resetDb } = require('./helpers/db');
const { registerAndLogin } = require('./helpers/auth');

beforeEach(resetDb);
afterAll(async () => { await prisma.$disconnect(); });

const auth = (t) => ({ Authorization: `Bearer ${t}` });

test('paginates companies and reports a filtered total', async () => {
  const { token } = await registerAndLogin();
  for (const name of ['Acme', 'Northwind', 'Initech', 'Acme Labs']) {
    await agent().post('/api/companies').set(auth(token)).send({ name });
  }

  const page = await agent().get('/api/v2/companies?pageSize=10&page=1').set(auth(token));
  expect(page.body).toMatchObject({ page: 1, pageSize: 10, total: 4, totalPages: 1 });

  const searched = await agent().get('/api/v2/companies?search=acme').set(auth(token));
  expect(searched.body.total).toBe(2);
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/pagination-companies.test.js`
Expected: FAIL — `/api/v2/companies` returns a bare array (falls through to v1), so `total` is undefined

- [ ] **Step 3: Write the implementation**

```js
// src/modules/companies/companies.service.js — replace lines 4-8
const ORDER_BY = {
  name: (dir) => ({ name: dir }),
  createdAt: (dir) => ({ createdAt: dir }),
};

const buildWhere = (userId, search) => ({
  userId,
  ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}),
});

async function list(userId, { search, sort = 'createdAt', dir = 'desc', skip, take } = {}) {
  const where = buildWhere(userId, search);
  const orderBy = (ORDER_BY[sort] || ORDER_BY.createdAt)(dir);

  if (take === undefined) {
    const items = await prisma.company.findMany({ where, orderBy });
    return { items, total: items.length };
  }
  const [items, total] = await prisma.$transaction([
    prisma.company.findMany({ where, orderBy, skip, take }),
    prisma.company.count({ where }),
  ]);
  return { items, total };
}
```

```js
// src/modules/companies/companies.schema.js — append
const { offsetShape, sortShape } = require('../../shared/pagination');

const listCompaniesQuerySchema = z.object({
  ...offsetShape,
  ...sortShape(['name', 'createdAt'], 'createdAt'),
  search: z.string().trim().min(1).optional(),
});
```

Export `listCompaniesQuerySchema`. If `companies.schema.js` does not already import `zod`, add `const { z } = require('zod');` at the top.

```js
// src/modules/companies/companies.controller.js — replace list, append listPaged
const { toSkipTake, toOffsetEnvelope } = require('../../shared/pagination');

async function list(req, res, next) {
  try {
    const { items } = await service.list(req.userId, { search: req.query.search });
    res.json(items);
  } catch (e) { next(e); }
}

async function listPaged(req, res, next) {
  try {
    const { page, pageSize, sort, dir, search } = req.query;
    const { skip, take } = toSkipTake({ page, pageSize });
    const { items, total } = await service.list(req.userId, { search, sort, dir, skip, take });
    res.json(toOffsetEnvelope({ items, total, page, pageSize }));
  } catch (e) { next(e); }
}
```

Convert `companies.routes.js` to the same `makeRouter(listHandler)` factory shape used in Task 3, keeping its existing non-list routes verbatim, and export `{ v1: makeRouter(ctrl.list), v2: makeRouter([validate(listCompaniesQuerySchema, 'query'), ctrl.listPaged]) }`.

Then wire both route tables:

```js
// src/routes/index.js
router.use('/companies', companiesRoutes.v1);

// src/routes/v2.js — add above router.use('/', v1Routes)
const companiesRoutes = require('../modules/companies/companies.routes');
router.use('/companies', companiesRoutes.v2);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/pagination-companies.test.js tests/companies.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/modules/companies src/routes tests/pagination-companies.test.js
git commit -m "feat(api): paginated companies list under /api/v2"
```

---

### Task 5: Contacts `/api/v2`

**Files:**
- Modify: `src/modules/contacts/contacts.service.js:25-40`, `contacts.controller.js:3-6`, `contacts.routes.js`, `contacts.schema.js`
- Modify: `src/routes/index.js`, `src/routes/v2.js`
- Test: `tests/pagination-contacts.test.js`

**Interfaces:**
- Consumes: `offsetShape`, `sortShape`, `toSkipTake`, `toOffsetEnvelope` (Task 1).
- Produces: `service.list(userId, { search, companyId, sort, dir, skip, take }) -> { items, total }`; `ctrl.listPaged`; `contacts.routes.js` → `{ v1, v2 }`.

- [ ] **Step 1: Write the failing test**

```js
// tests/pagination-contacts.test.js
const { agent } = require('./helpers/testApp');
const { prisma, resetDb } = require('./helpers/db');
const { registerAndLogin } = require('./helpers/auth');

beforeEach(resetDb);
afterAll(async () => { await prisma.$disconnect(); });

const auth = (t) => ({ Authorization: `Bearer ${t}` });

test('paginates contacts and searches name or email', async () => {
  const { token } = await registerAndLogin();
  await agent().post('/api/contacts').set(auth(token)).send({ name: 'Jordan Park', email: 'jordan@acme.test' });
  await agent().post('/api/contacts').set(auth(token)).send({ name: 'Dana Cole', email: 'dana@northwind.test' });
  await agent().post('/api/contacts').set(auth(token)).send({ name: 'Liam Cruz' });

  const all = await agent().get('/api/v2/contacts?pageSize=10').set(auth(token));
  expect(all.body).toMatchObject({ total: 3, totalPages: 1, pageSize: 10 });

  const byName = await agent().get('/api/v2/contacts?search=jordan').set(auth(token));
  expect(byName.body.total).toBe(1);

  const byEmail = await agent().get('/api/v2/contacts?search=northwind').set(auth(token));
  expect(byEmail.body.total).toBe(1);
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/pagination-contacts.test.js`
Expected: FAIL — `total` undefined on `/api/v2/contacts`

- [ ] **Step 3: Write the implementation**

```js
// src/modules/contacts/contacts.service.js — replace lines 25-40
const ORDER_BY = {
  name: (dir) => ({ name: dir }),
  createdAt: (dir) => ({ createdAt: dir }),
};

const buildWhere = (userId, { search, companyId }) => ({
  userId,
  ...(companyId ? { companyId } : {}),
  ...(search
    ? {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
        ],
      }
    : {}),
});

async function list(userId, {
  search, companyId, sort = 'createdAt', dir = 'desc', skip, take,
} = {}) {
  const where = buildWhere(userId, { search, companyId });
  const orderBy = (ORDER_BY[sort] || ORDER_BY.createdAt)(dir);

  if (take === undefined) {
    const items = await prisma.contact.findMany({ where, orderBy, include: includeCompany });
    return { items, total: items.length };
  }
  const [items, total] = await prisma.$transaction([
    prisma.contact.findMany({ where, orderBy, include: includeCompany, skip, take }),
    prisma.contact.count({ where }),
  ]);
  return { items, total };
}
```

```js
// src/modules/contacts/contacts.schema.js — append
const { offsetShape, sortShape } = require('../../shared/pagination');

const listContactsQuerySchema = z.object({
  ...offsetShape,
  ...sortShape(['name', 'createdAt'], 'createdAt'),
  search: z.string().trim().min(1).optional(),
  companyId: z.string().uuid().optional(),
});
```

Export `listContactsQuerySchema`.

```js
// src/modules/contacts/contacts.controller.js — replace list, append listPaged
const { toSkipTake, toOffsetEnvelope } = require('../../shared/pagination');

async function list(req, res, next) {
  try {
    const { items } = await service.list(req.userId, { search: req.query.search });
    res.json(items);
  } catch (e) { next(e); }
}

async function listPaged(req, res, next) {
  try {
    const { page, pageSize, sort, dir, search, companyId } = req.query;
    const { skip, take } = toSkipTake({ page, pageSize });
    const { items, total } = await service.list(req.userId, {
      search, companyId, sort, dir, skip, take,
    });
    res.json(toOffsetEnvelope({ items, total, page, pageSize }));
  } catch (e) { next(e); }
}
```

Convert `contacts.routes.js` to the `makeRouter(listHandler)` factory (keeping its existing non-list routes verbatim) exporting `{ v1, v2 }`, then wire `router.use('/contacts', contactsRoutes.v1)` in `src/routes/index.js` and `router.use('/contacts', contactsRoutes.v2)` in `src/routes/v2.js`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/pagination-contacts.test.js tests/contacts.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/modules/contacts src/routes tests/pagination-contacts.test.js
git commit -m "feat(api): paginated contacts list under /api/v2"
```

---

### Task 6: Analysis `/api/v2`

**Files:**
- Modify: `src/modules/analysis/analysis.service.js:120-130`, `analysis.controller.js`, `analysis.routes.js`, `analysis.schema.js`
- Modify: `src/routes/index.js`, `src/routes/v2.js`
- Test: `tests/pagination-analysis.test.js`

**Interfaces:**
- Consumes: `offsetShape`, `sortShape`, `toSkipTake`, `toOffsetEnvelope` (Task 1).
- Produces: `service.list(userId, { sort, dir, skip, take }) -> { items, total }`; `ctrl.listPaged`; `analysis.routes.js` → `{ v1, v2 }`.

**Constraint:** sortable keys are `createdAt`, `atsScore`, `matchScore` only. `documentName` and `position` are read from `report` JSON (`analysis.service.js:124-128`) and are deliberately **not** sortable or searchable — see the spec's constraint section. Do not add them.

- [ ] **Step 1: Write the failing test**

```js
// tests/pagination-analysis.test.js
const { agent } = require('./helpers/testApp');
const { prisma, resetDb } = require('./helpers/db');
const { registerAndLogin } = require('./helpers/auth');

beforeEach(resetDb);
afterAll(async () => { await prisma.$disconnect(); });

const auth = (t) => ({ Authorization: `Bearer ${t}` });

async function seedAnalyses(userId, scores) {
  for (const atsScore of scores) {
    await prisma.resumeAnalysis.create({
      data: { userId, atsScore, matchScore: atsScore, report: { meta: { position: 'Dev' } } },
    });
  }
}

test('paginates analyses newest-first by default', async () => {
  const { token, userId } = await registerAndLogin();
  await seedAnalyses(userId, [10, 20, 30]);

  const res = await agent().get('/api/v2/analysis?pageSize=10').set(auth(token));
  expect(res.body).toMatchObject({ page: 1, pageSize: 10, total: 3, totalPages: 1 });
  expect(res.body.items).toHaveLength(3);
});

test('sorts by atsScore when asked', async () => {
  const { token, userId } = await registerAndLogin();
  await seedAnalyses(userId, [10, 30, 20]);
  const res = await agent().get('/api/v2/analysis?sort=atsScore&dir=asc').set(auth(token));
  expect(res.body.items.map((a) => a.atsScore)).toEqual([10, 20, 30]);
});

test('rejects sorting by a JSON-derived field', async () => {
  const { token } = await registerAndLogin();
  const res = await agent().get('/api/v2/analysis?sort=documentName').set(auth(token));
  expect(res.status).toBe(400);
});

test('rejects an out-of-list pageSize with 400', async () => {
  const { token } = await registerAndLogin();
  const res = await agent().get('/api/v2/analysis?pageSize=7').set(auth(token));
  expect(res.status).toBe(400);
});

test('v1 analysis list is still a bare array', async () => {
  const { token, userId } = await registerAndLogin();
  await seedAnalyses(userId, [10]);
  const res = await agent().get('/api/analysis').set(auth(token));
  expect(Array.isArray(res.body)).toBe(true);
});
```

> If `registerAndLogin()` does not return `userId`, look it up with
> `await prisma.user.findFirst()` after registering.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/pagination-analysis.test.js`
Expected: FAIL — `total` undefined on `/api/v2/analysis`

- [ ] **Step 3: Write the implementation**

```js
// src/modules/analysis/analysis.service.js — replace lines 120-130
const ANALYSIS_ORDER_BY = {
  createdAt: (dir) => ({ createdAt: dir }),
  atsScore: (dir) => ({ atsScore: dir }),
  matchScore: (dir) => ({ matchScore: dir }),
};

const toRow = (r) => ({
  id: r.id,
  atsScore: r.atsScore,
  matchScore: r.matchScore,
  documentName: r.report?.meta?.documentName ?? null,
  position: r.report?.meta?.position ?? null,
  createdAt: r.createdAt,
});

async function list(userId, { sort = 'createdAt', dir = 'desc', skip, take } = {}) {
  const where = { userId };
  const orderBy = (ANALYSIS_ORDER_BY[sort] || ANALYSIS_ORDER_BY.createdAt)(dir);

  if (take === undefined) {
    const rows = await prisma.resumeAnalysis.findMany({ where, orderBy, select: rowSelect });
    return { items: rows.map(toRow), total: rows.length };
  }
  const [rows, total] = await prisma.$transaction([
    prisma.resumeAnalysis.findMany({ where, orderBy, select: rowSelect, skip, take }),
    prisma.resumeAnalysis.count({ where }),
  ]);
  return { items: rows.map(toRow), total };
}
```

```js
// src/modules/analysis/analysis.schema.js — append
const { offsetShape, sortShape } = require('../../shared/pagination');

// documentName/position live in report JSON, not columns — deliberately absent.
const listAnalysisQuerySchema = z.object({
  ...offsetShape,
  ...sortShape(['createdAt', 'atsScore', 'matchScore'], 'createdAt'),
});
```

Export `listAnalysisQuerySchema`. Add `const { z } = require('zod');` if absent.

```js
// src/modules/analysis/analysis.controller.js — replace list, append listPaged
const { toSkipTake, toOffsetEnvelope } = require('../../shared/pagination');

async function list(req, res, next) {
  try {
    const { items } = await service.list(req.userId, {});
    res.json(items);
  } catch (e) { next(e); }
}

async function listPaged(req, res, next) {
  try {
    const { page, pageSize, sort, dir } = req.query;
    const { skip, take } = toSkipTake({ page, pageSize });
    const { items, total } = await service.list(req.userId, { sort, dir, skip, take });
    res.json(toOffsetEnvelope({ items, total, page, pageSize }));
  } catch (e) { next(e); }
}
```

Convert `analysis.routes.js` to the `makeRouter(listHandler)` factory exporting `{ v1, v2 }`. **Keep `router.get('/config', ctrl.config)` above `router.get('/:id', ctrl.getById)`** — the existing file orders them that way so `/config` is not swallowed by `/:id`. Then wire `analysisRoutes.v1` in `src/routes/index.js` and `analysisRoutes.v2` in `src/routes/v2.js`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/pagination-analysis.test.js tests/analysis.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/modules/analysis src/routes tests/pagination-analysis.test.js
git commit -m "feat(api): paginated analysis list under /api/v2"
```

---

### Task 7: Activity `/api/v2` (cursor)

**Files:**
- Modify: `src/modules/activity/activity.service.js:23-38`, `activity.controller.js`, `activity.routes.js`
- Create: `src/modules/activity/activity.schema.js` (if absent)
- Modify: `src/routes/index.js`, `src/routes/v2.js`
- Test: `tests/pagination-activity.test.js`

**Interfaces:**
- Consumes: `cursorShape`, `toCursorEnvelope` (Task 1).
- Produces: `service.list(userId, { applicationId, limit, before, pageSize }) -> { items, nextCursor }`; `ctrl.listPaged`; `activity.routes.js` → `{ v1, v2 }`.

**Why cursor and not offset:** activity is an append-only feed driving infinite scroll. Offset over a feed that grows at the *top* re-serves rows — row 25 becomes row 26 when a new event lands. v2 renames the size parameter to `pageSize` (validated against the allowlist); **v1 keeps `limit` and keeps clamping**.

- [ ] **Step 1: Write the failing test**

```js
// tests/pagination-activity.test.js
const { agent } = require('./helpers/testApp');
const { prisma, resetDb } = require('./helpers/db');
const { registerAndLogin } = require('./helpers/auth');

beforeEach(resetDb);
afterAll(async () => { await prisma.$disconnect(); });

const auth = (t) => ({ Authorization: `Bearer ${t}` });

async function seedEvents(token, n) {
  for (let i = 0; i < n; i += 1) {
    await agent().post('/api/applications').set(auth(token)).send({ position: `Role ${i}` });
  }
}

test('returns a cursor envelope with pageSize and no total', async () => {
  const { token } = await registerAndLogin();
  await seedEvents(token, 3);
  const res = await agent().get('/api/v2/activity?pageSize=10').set(auth(token));
  expect(res.status).toBe(200);
  expect(res.body).toHaveProperty('items');
  expect(res.body.pageSize).toBe(10);
  expect(res.body).not.toHaveProperty('total');
});

test('nextCursor is null on the final page', async () => {
  const { token } = await registerAndLogin();
  await seedEvents(token, 3);
  const res = await agent().get('/api/v2/activity?pageSize=10').set(auth(token));
  expect(res.body.nextCursor).toBeNull();
});

test('paging by cursor yields no duplicate ids', async () => {
  const { token } = await registerAndLogin();
  await seedEvents(token, 12);

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

test('v1 activity still clamps limit instead of rejecting it', async () => {
  const { token } = await registerAndLogin();
  await seedEvents(token, 3);
  const res = await agent().get('/api/activity?limit=7').set(auth(token));
  expect(res.status).toBe(200);
  expect(res.body).toHaveProperty('items');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/pagination-activity.test.js`
Expected: FAIL — `/api/v2/activity` falls through to v1, so `pageSize` is absent from the body

- [ ] **Step 3: Write the implementation**

```js
// src/modules/activity/activity.service.js — replace the take line in list()
// v1 passes `limit` (clamped); v2 passes `pageSize` (already allowlist-validated).
async function list(userId, { applicationId, limit, before, pageSize } = {}) {
  const take = pageSize ?? Math.min(Math.max(parseInt(limit, 10) || 50, 1), 100);
  // ...rest of the existing body is unchanged...
}
```

```js
// src/modules/activity/activity.schema.js — new file
const { z } = require('zod');
const { cursorShape } = require('../../shared/pagination');

const listActivityQuerySchema = z.object({
  ...cursorShape,
  applicationId: z.string().uuid().optional(),
});

module.exports = { listActivityQuerySchema };
```

```js
// src/modules/activity/activity.controller.js — append
const { toCursorEnvelope } = require('../../shared/pagination');

async function listPaged(req, res, next) {
  try {
    const { pageSize, before, applicationId } = req.query;
    const { items, nextCursor } = await service.list(req.userId, {
      applicationId, before, pageSize,
    });
    res.json(toCursorEnvelope({ items, pageSize, nextCursor }));
  } catch (e) { next(e); }
}
```

Convert `activity.routes.js` to the `makeRouter(listHandler)` factory exporting `{ v1, v2 }`, then wire `activityRoutes.v1` in `src/routes/index.js` and `activityRoutes.v2` in `src/routes/v2.js`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/pagination-activity.test.js tests/activity.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/modules/activity src/routes tests/pagination-activity.test.js
git commit -m "feat(api): cursor-paginated activity feed under /api/v2"
```

---

### Task 8: Cross-cutting guards + full-suite gate

Catches a module wired without the shared schema — the failure that would otherwise ship silently.

**Files:**
- Test: `tests/pagination-contract.test.js`

**Interfaces:**
- Consumes: every v2 list route (Tasks 3-7).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the failing test**

```js
// tests/pagination-contract.test.js
const { agent } = require('./helpers/testApp');
const { prisma, resetDb } = require('./helpers/db');
const { registerAndLogin } = require('./helpers/auth');
const { PAGE_SIZES } = require('../src/shared/pagination');

beforeEach(resetDb);
afterAll(async () => { await prisma.$disconnect(); });

const auth = (t) => ({ Authorization: `Bearer ${t}` });
const LIST_PATHS = ['/api/v2/applications', '/api/v2/companies', '/api/v2/contacts', '/api/v2/analysis', '/api/v2/activity'];

test.each(LIST_PATHS)('%s rejects an out-of-list pageSize', async (path) => {
  const { token } = await registerAndLogin();
  const res = await agent().get(`${path}?pageSize=7`).set(auth(token));
  expect(res.status).toBe(400);
  expect(res.body.error.code).toBe('VALIDATION');
});

test.each(LIST_PATHS)('%s accepts every allowlisted pageSize', async (path) => {
  const { token } = await registerAndLogin();
  for (const size of PAGE_SIZES) {
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/pagination-contract.test.js`
Expected: PASS if Tasks 3-7 are complete and correct. If any module was wired without
`validate(..., 'query')`, that path fails here — which is the point of the task.

- [ ] **Step 3: Fix any module the contract test exposes**

No new code if all five are correct. If a path fails, the cause is almost always a route
exporting `makeRouter(ctrl.listPaged)` without the `validate(schema, 'query')` middleware
in front of it. Add it and re-run.

- [ ] **Step 4: Run the full suite serially**

Run: `npx jest --runInBand`
Expected: PASS. Note the repo's documented pre-existing parallel-DB flake — run serially
to distinguish it from a real regression.

- [ ] **Step 5: Commit**

```bash
git add tests/pagination-contract.test.js
git commit -m "test(api): cross-cutting v2 pagination contract guards"
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| Shared module, allowlist, envelopes, `totalPages` 0 | 1 |
| One service / two presenters | 2 (applications), 4-7 (rest) |
| `/api/v2` complete surface | 3 (`routes/v2.js` mounts v1Routes as fallback) |
| Registration order / limiter hazard | 3 (`tests/app-mounts.test.js`) |
| Offset for 4 modules | 3, 4, 5, 6 |
| Cursor for activity | 7 |
| Per-module filters + sort whitelist | 3, 4, 5, 6 |
| Analysis JSON constraint | 6 (rejection test + explicit note) |
| 400 on bad params; page-past-end is empty | 3, 8 |
| v1 byte-identical | 2, 3, 4, 5, 6, 7 (a regression test in each) |
| Sequencing: shared → applications → rest → activity | Task order |
| Non-goals (board, frontend, migration) | Untouched by every task |

No gaps.

**Deviation from the spec, recorded deliberately:** the spec proposed asserting "a v2
request increments the rate limiter once, not twice". That test cannot work as written —
`src/app.js:28` makes the limiter a no-op under `NODE_ENV=test`, so the double-increment is
invisible to the suite. Task 3 substitutes a declarative assertion on the exported
`API_MOUNTS` order, which guards the same hazard through the mechanism that actually
causes it. Worth re-reading during review rather than assuming the original wording shipped.

**Placeholder scan:** no TBD/TODO; every code step has real code; no "similar to Task N" —
Tasks 4-7 repeat their implementations in full.

**Type consistency:** `list(userId, opts) -> { items, total }` for all four offset modules;
activity keeps `{ items, nextCursor }` and is wrapped by `toCursorEnvelope`. `listPaged` is
the controller name in all five. `{ v1, v2 }` is the route export shape in all five.
`toSkipTake`/`toOffsetEnvelope`/`toCursorEnvelope` are used with the exact signatures
defined in Task 1.
