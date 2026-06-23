# Contacts (v2) — Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `contacts` backend module (full CRUD) plus application↔contact link/unlink endpoints, and include linked contacts on application detail.

**Architecture:** New `Contact` model (per-user, optional `companyId` FK) and an explicit `ApplicationContact` join model, following the existing modular-monolith pattern: routes → validate (Zod) → controller → service, every service function keyed by `userId`. Link/unlink endpoints live under `/api/applications/:id/contacts` (the application is the resource being modified) but delegate to `contacts.service` for cohesion.

**Tech Stack:** Express 4, Prisma 6 (PostgreSQL), Zod 3, Jest 29 + Supertest 7. CommonJS.

## Global Constraints

- **CommonJS** throughout (`require` / `module.exports`).
- **Data isolation is mandatory:** every Prisma query filters by `userId`; use `findFirst({ where: { id, userId } })` so a miss returns 404 (not-found == not-owned).
- **Prisma client singleton:** `const prisma = require('../../shared/database/prisma');`
- **Errors:** services throw `AppError` subclasses from `../../shared/utils/errors` (`NotFoundError`→404, `ConflictError`→409, `ValidationError`→400); controllers `try/catch` and `next(e)`. Response shape `{ error: { message, code, details? } }`.
- **Validation:** routes use `validate(schema)` middleware; schemas exported as `create<Module>Schema` / `update<Module>Schema`.
- **Local DB:** Postgres via Docker on host port **5434**; `docker compose up -d` before `npm test`. Tests run `jest --runInBand`; `globalSetup.js` runs `prisma migrate deploy` against `.env.test` (DB `jobcrm_test`).
- **Commit trailer:** `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- **Branch:** do all work on `feat/contacts` in this repo.

---

### Task 0: Create the feature branch

- [ ] **Step 1: Branch off main**

```bash
cd /Users/angelito/personal/SmartJobSearchCRM/SmartJobSearchCRM-BE
git checkout main && git pull --ff-only 2>/dev/null; git checkout -b feat/contacts
git status
```
Expected: on branch `feat/contacts`, clean tree (the committed spec is already on main).

---

### Task 1: Prisma schema — Contact + ApplicationContact models + migration

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `tests/helpers/db.js` (reset order for new tables)

**Interfaces:**
- Produces: Prisma models `Contact` (relation field `applicationLinks ApplicationContact[]`, `company Company?`) and `ApplicationContact` (`@@unique([applicationId, contactId])`); back-relations `User.contacts`, `Company.contacts`, `Application.contactLinks`.

- [ ] **Step 1: Add the two models to `prisma/schema.prisma`**

Append these models at the end of the file:

```prisma
model Contact {
  id               String               @id @default(uuid())
  userId           String
  user             User                 @relation(fields: [userId], references: [id], onDelete: Cascade)
  companyId        String?
  company          Company?             @relation(fields: [companyId], references: [id], onDelete: SetNull)
  name             String
  email            String?
  position         String?
  phone            String?
  linkedinUrl      String?
  notes            String?
  followUpDate     DateTime?
  createdAt        DateTime             @default(now())
  updatedAt        DateTime             @updatedAt
  applicationLinks ApplicationContact[]

  @@index([userId])
  @@index([companyId])
}

model ApplicationContact {
  id            String      @id @default(uuid())
  applicationId String
  application   Application @relation(fields: [applicationId], references: [id], onDelete: Cascade)
  contactId     String
  contact       Contact     @relation(fields: [contactId], references: [id], onDelete: Cascade)
  createdAt     DateTime    @default(now())

  @@unique([applicationId, contactId])
  @@index([applicationId])
  @@index([contactId])
}
```

- [ ] **Step 2: Add back-relations to existing models**

In `model User { ... }`, add to its relation list:
```prisma
  contacts      Contact[]
```
In `model Company { ... }`, add after `applications Application[]`:
```prisma
  contacts     Contact[]
```
In `model Application { ... }`, add after `interviews Interview[]`:
```prisma
  contactLinks ApplicationContact[]
```

- [ ] **Step 3: Update `tests/helpers/db.js` reset order (children before parents)**

Replace the body of `resetDb` so the new tables are cleared first:
```javascript
const prisma = require('../../src/shared/database/prisma');

async function resetDb() {
  await prisma.applicationContact.deleteMany();
  await prisma.interview.deleteMany();
  await prisma.application.deleteMany();
  await prisma.contact.deleteMany();
  await prisma.company.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.user.deleteMany();
}

module.exports = { prisma, resetDb };
```

- [ ] **Step 4: Ensure the DB is up, then create + apply the migration**

```bash
docker compose up -d
npx prisma migrate dev --name add_contacts
```
Expected: a new folder under `prisma/migrations/*_add_contacts/` with `migration.sql`; Prisma Client regenerates without error.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations tests/helpers/db.js
git commit -m "feat(db): add Contact and ApplicationContact models + migration

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Contacts module — CRUD (list/get/create/update/delete)

**Files:**
- Create: `src/modules/contacts/contacts.schema.js`
- Create: `src/modules/contacts/contacts.service.js`
- Create: `src/modules/contacts/contacts.controller.js`
- Create: `src/modules/contacts/contacts.routes.js`
- Modify: `src/routes/index.js` (mount `/contacts`)
- Test: `tests/contacts.test.js`

**Interfaces:**
- Consumes: `prisma` singleton; `NotFoundError`, `ConflictError` from `shared/utils/errors`; `requireAuth`, `validate` middleware.
- Produces: service `{ list, getById, create, update, remove, assertContact, linkApplication, unlinkApplication }` (link/unlink added in Task 3); schemas `{ createContactSchema, updateContactSchema, linkContactSchema }`. Contact responses include `company: {id,name} | null`. Detail (`getById`) additionally returns `applications: [{ id, position, company }]`.

- [ ] **Step 1: Write the failing test file `tests/contacts.test.js`**

```javascript
const { agent } = require('./helpers/testApp');
const { prisma, resetDb } = require('./helpers/db');
const { registerAndLogin } = require('./helpers/auth');

beforeEach(resetDb);
afterAll(async () => { await prisma.$disconnect(); });

const auth = (t) => ({ Authorization: `Bearer ${t}` });

async function makeCompany(token, name = 'Acme') {
  const res = await agent().post('/api/companies').set(auth(token)).send({ name });
  return res.body.id;
}

test('create + list a contact (company included)', async () => {
  const { token } = await registerAndLogin();
  const companyId = await makeCompany(token, 'Acme');
  const created = await agent().post('/api/contacts').set(auth(token))
    .send({ name: 'Jane Recruiter', email: 'jane@acme.com', position: 'Recruiter', companyId });
  expect(created.status).toBe(201);
  expect(created.body).toMatchObject({ name: 'Jane Recruiter', position: 'Recruiter' });
  expect(created.body.company).toMatchObject({ id: companyId, name: 'Acme' });

  const list = await agent().get('/api/contacts').set(auth(token));
  expect(list.status).toBe(200);
  expect(list.body).toHaveLength(1);
  expect(list.body[0].company).toMatchObject({ id: companyId, name: 'Acme' });
});

test('a contact with no company has company: null', async () => {
  const { token } = await registerAndLogin();
  const res = await agent().post('/api/contacts').set(auth(token)).send({ name: 'Solo' });
  expect(res.status).toBe(201);
  expect(res.body.company).toBeNull();
});

test('create requires a name (400)', async () => {
  const { token } = await registerAndLogin();
  const res = await agent().post('/api/contacts').set(auth(token)).send({ email: 'x@y.com' });
  expect(res.status).toBe(400);
});

test('rejects a malformed email (400)', async () => {
  const { token } = await registerAndLogin();
  const res = await agent().post('/api/contacts').set(auth(token))
    .send({ name: 'Bad', email: 'not-an-email' });
  expect(res.status).toBe(400);
});

test('rejects a malformed linkedinUrl (400)', async () => {
  const { token } = await registerAndLogin();
  const res = await agent().post('/api/contacts').set(auth(token))
    .send({ name: 'Bad', linkedinUrl: 'notaurl' });
  expect(res.status).toBe(400);
});

test('requires authentication (401)', async () => {
  const res = await agent().get('/api/contacts');
  expect(res.status).toBe(401);
});

test('search filters by name or email (case-insensitive)', async () => {
  const { token } = await registerAndLogin();
  await agent().post('/api/contacts').set(auth(token)).send({ name: 'Jane', email: 'jane@acme.com' });
  await agent().post('/api/contacts').set(auth(token)).send({ name: 'Bob', email: 'bob@globex.com' });
  const byName = await agent().get('/api/contacts?search=jan').set(auth(token));
  expect(byName.body).toHaveLength(1);
  expect(byName.body[0].name).toBe('Jane');
  const byEmail = await agent().get('/api/contacts?search=globex').set(auth(token));
  expect(byEmail.body).toHaveLength(1);
  expect(byEmail.body[0].name).toBe('Bob');
});

test('update a contact, then clear its company with companyId:null', async () => {
  const { token } = await registerAndLogin();
  const companyId = await makeCompany(token, 'Acme');
  const c = await agent().post('/api/contacts').set(auth(token)).send({ name: 'Jane', companyId });
  const upd = await agent().patch(`/api/contacts/${c.body.id}`).set(auth(token))
    .send({ position: 'Lead Recruiter' });
  expect(upd.body.position).toBe('Lead Recruiter');
  const cleared = await agent().patch(`/api/contacts/${c.body.id}`).set(auth(token))
    .send({ companyId: null });
  expect(cleared.body.companyId).toBeNull();
  expect(cleared.body.company).toBeNull();
});

test('delete a contact', async () => {
  const { token } = await registerAndLogin();
  const c = await agent().post('/api/contacts').set(auth(token)).send({ name: 'Jane' });
  const del = await agent().delete(`/api/contacts/${c.body.id}`).set(auth(token));
  expect(del.status).toBe(204);
  const after = await agent().get('/api/contacts').set(auth(token));
  expect(after.body).toHaveLength(0);
});

test('rejects a companyId owned by another user (404)', async () => {
  const a = await registerAndLogin();
  const b = await registerAndLogin();
  const companyId = await makeCompany(a.token);
  const res = await agent().post('/api/contacts').set(auth(b.token))
    .send({ name: 'X', companyId });
  expect(res.status).toBe(404);
});

test('a user cannot read another user\'s contact (404)', async () => {
  const a = await registerAndLogin();
  const b = await registerAndLogin();
  const c = await agent().post('/api/contacts').set(auth(a.token)).send({ name: 'Secret' });
  const res = await agent().get(`/api/contacts/${c.body.id}`).set(auth(b.token));
  expect(res.status).toBe(404);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- contacts`
Expected: FAIL (route `/api/contacts` 404s / module not found).

- [ ] **Step 3: Create `src/modules/contacts/contacts.schema.js`**

```javascript
const { z } = require('zod');

const baseFields = {
  name: z.string().min(1).max(200),
  email: z.string().email().max(320).optional(),
  position: z.string().max(200).optional(),
  phone: z.string().max(50).optional(),
  linkedinUrl: z.string().url().max(500).optional(),
  notes: z.string().max(20000).optional(),
  companyId: z.string().uuid().nullable().optional(),
  followUpDate: z.coerce.date().optional(),
};

const createContactSchema = z.object(baseFields);
const updateContactSchema = z.object({
  ...baseFields,
  name: baseFields.name.optional(),
}).refine((d) => Object.keys(d).length > 0, { message: 'At least one field required' });

const linkContactSchema = z.object({ contactId: z.string().uuid() });

module.exports = { createContactSchema, updateContactSchema, linkContactSchema };
```

- [ ] **Step 4: Create `src/modules/contacts/contacts.service.js`**

```javascript
const prisma = require('../../shared/database/prisma');
const { NotFoundError, ConflictError } = require('../../shared/utils/errors');

const includeCompany = { company: { select: { id: true, name: true } } };

async function assertCompany(userId, companyId) {
  if (companyId === undefined || companyId === null) return;
  const company = await prisma.company.findFirst({ where: { id: companyId, userId } });
  if (!company) throw new NotFoundError('Company not found');
}

async function assertContact(userId, contactId) {
  const contact = await prisma.contact.findFirst({ where: { id: contactId, userId } });
  if (!contact) throw new NotFoundError('Contact not found');
  return contact;
}

async function assertApplication(userId, applicationId) {
  const app = await prisma.application.findFirst({ where: { id: applicationId, userId } });
  if (!app) throw new NotFoundError('Application not found');
  return app;
}

const list = (userId, search) =>
  prisma.contact.findMany({
    where: {
      userId,
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { email: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: 'desc' },
    include: includeCompany,
  });

async function getById(userId, id) {
  const contact = await prisma.contact.findFirst({
    where: { id, userId },
    include: {
      company: { select: { id: true, name: true } },
      applicationLinks: {
        include: {
          application: {
            select: { id: true, position: true, company: { select: { id: true, name: true } } },
          },
        },
      },
    },
  });
  if (!contact) throw new NotFoundError('Contact not found');
  const { applicationLinks, ...rest } = contact;
  return { ...rest, applications: applicationLinks.map((l) => l.application) };
}

async function create(userId, data) {
  await assertCompany(userId, data.companyId);
  return prisma.contact.create({ data: { ...data, userId }, include: includeCompany });
}

async function update(userId, id, data) {
  await assertContact(userId, id);
  await assertCompany(userId, data.companyId);
  return prisma.contact.update({ where: { id }, data, include: includeCompany });
}

async function remove(userId, id) {
  await assertContact(userId, id);
  await prisma.contact.delete({ where: { id } });
}

async function linkApplication(userId, applicationId, contactId) {
  await assertApplication(userId, applicationId);
  await assertContact(userId, contactId);
  const existing = await prisma.applicationContact.findUnique({
    where: { applicationId_contactId: { applicationId, contactId } },
  });
  if (existing) throw new ConflictError('Contact already linked to this application');
  await prisma.applicationContact.create({ data: { applicationId, contactId } });
  return prisma.contact.findFirst({ where: { id: contactId }, include: includeCompany });
}

async function unlinkApplication(userId, applicationId, contactId) {
  await assertApplication(userId, applicationId);
  await assertContact(userId, contactId);
  await prisma.applicationContact.deleteMany({ where: { applicationId, contactId } });
}

module.exports = {
  list, getById, create, update, remove,
  assertContact, linkApplication, unlinkApplication,
};
```

- [ ] **Step 5: Create `src/modules/contacts/contacts.controller.js`**

```javascript
const service = require('./contacts.service');

async function list(req, res, next) {
  try { res.json(await service.list(req.userId, req.query.search)); }
  catch (e) { next(e); }
}
async function getById(req, res, next) {
  try { res.json(await service.getById(req.userId, req.params.id)); }
  catch (e) { next(e); }
}
async function create(req, res, next) {
  try { res.status(201).json(await service.create(req.userId, req.body)); }
  catch (e) { next(e); }
}
async function update(req, res, next) {
  try { res.json(await service.update(req.userId, req.params.id, req.body)); }
  catch (e) { next(e); }
}
async function remove(req, res, next) {
  try { await service.remove(req.userId, req.params.id); res.status(204).end(); }
  catch (e) { next(e); }
}

module.exports = { list, getById, create, update, remove };
```

- [ ] **Step 6: Create `src/modules/contacts/contacts.routes.js`**

```javascript
const { Router } = require('express');
const { requireAuth } = require('../../shared/middleware/auth');
const { validate } = require('../../shared/middleware/validate');
const { createContactSchema, updateContactSchema } = require('./contacts.schema');
const ctrl = require('./contacts.controller');

const router = Router();
router.use(requireAuth);

router.get('/', ctrl.list);
router.post('/', validate(createContactSchema), ctrl.create);
router.get('/:id', ctrl.getById);
router.patch('/:id', validate(updateContactSchema), ctrl.update);
router.delete('/:id', ctrl.remove);

module.exports = router;
```

- [ ] **Step 7: Mount the router in `src/routes/index.js`**

Add the require near the other module requires:
```javascript
const contactsRoutes = require('../modules/contacts/contacts.routes');
```
Add the mount after the `companies` line:
```javascript
router.use('/contacts', contactsRoutes);
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npm test -- contacts`
Expected: PASS (all Task-2 tests green).

- [ ] **Step 9: Commit**

```bash
git add src/modules/contacts src/routes/index.js tests/contacts.test.js
git commit -m "feat(contacts): CRUD module (list/get/create/update/delete)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Application↔Contact link/unlink + contacts on application detail

**Files:**
- Modify: `src/modules/applications/applications.service.js` (`getById` includes contacts)
- Modify: `src/modules/applications/applications.controller.js` (`linkContact`, `unlinkContact`)
- Modify: `src/modules/applications/applications.routes.js` (two nested routes)
- Test: append to `tests/contacts.test.js`

**Interfaces:**
- Consumes: `contacts.service.{linkApplication, unlinkApplication}`; `contacts.schema.linkContactSchema`.
- Produces: `POST /api/applications/:id/contacts {contactId}` → 201 (linked contact, company included) / 409 on duplicate; `DELETE /api/applications/:id/contacts/:contactId` → 204; `GET /api/applications/:id` response gains `contacts: [{ id, name, position, company }]`.

- [ ] **Step 1: Append failing tests to `tests/contacts.test.js`**

```javascript
async function makeApplication(token, position = 'Backend Eng') {
  const res = await agent().post('/api/applications').set(auth(token)).send({ position });
  return res.body.id;
}

test('link a contact to an application; it appears on application detail', async () => {
  const { token } = await registerAndLogin();
  const companyId = await makeCompany(token, 'Acme');
  const appId = await makeApplication(token);
  const c = await agent().post('/api/contacts').set(auth(token))
    .send({ name: 'Jane', position: 'Recruiter', companyId });

  const link = await agent().post(`/api/applications/${appId}/contacts`).set(auth(token))
    .send({ contactId: c.body.id });
  expect(link.status).toBe(201);

  const detail = await agent().get(`/api/applications/${appId}`).set(auth(token));
  expect(detail.body.contacts).toHaveLength(1);
  expect(detail.body.contacts[0]).toMatchObject({ id: c.body.id, name: 'Jane', position: 'Recruiter' });
  expect(detail.body.contacts[0].company).toMatchObject({ id: companyId, name: 'Acme' });
});

test('linking the same contact twice returns 409', async () => {
  const { token } = await registerAndLogin();
  const appId = await makeApplication(token);
  const c = await agent().post('/api/contacts').set(auth(token)).send({ name: 'Jane' });
  await agent().post(`/api/applications/${appId}/contacts`).set(auth(token)).send({ contactId: c.body.id });
  const dup = await agent().post(`/api/applications/${appId}/contacts`).set(auth(token)).send({ contactId: c.body.id });
  expect(dup.status).toBe(409);
});

test('unlink a contact from an application', async () => {
  const { token } = await registerAndLogin();
  const appId = await makeApplication(token);
  const c = await agent().post('/api/contacts').set(auth(token)).send({ name: 'Jane' });
  await agent().post(`/api/applications/${appId}/contacts`).set(auth(token)).send({ contactId: c.body.id });
  const unlink = await agent().delete(`/api/applications/${appId}/contacts/${c.body.id}`).set(auth(token));
  expect(unlink.status).toBe(204);
  const detail = await agent().get(`/api/applications/${appId}`).set(auth(token));
  expect(detail.body.contacts).toHaveLength(0);
});

test('an application with no contacts has contacts: []', async () => {
  const { token } = await registerAndLogin();
  const appId = await makeApplication(token);
  const detail = await agent().get(`/api/applications/${appId}`).set(auth(token));
  expect(detail.body.contacts).toEqual([]);
});

test('cannot link another user\'s contact (404)', async () => {
  const a = await registerAndLogin();
  const b = await registerAndLogin();
  const appId = await makeApplication(b.token);
  const c = await agent().post('/api/contacts').set(auth(a.token)).send({ name: 'Jane' });
  const res = await agent().post(`/api/applications/${appId}/contacts`).set(auth(b.token))
    .send({ contactId: c.body.id });
  expect(res.status).toBe(404);
});

test('cannot link to another user\'s application (404)', async () => {
  const a = await registerAndLogin();
  const b = await registerAndLogin();
  const appId = await makeApplication(a.token);
  const c = await agent().post('/api/contacts').set(auth(b.token)).send({ name: 'Jane' });
  const res = await agent().post(`/api/applications/${appId}/contacts`).set(auth(b.token))
    .send({ contactId: c.body.id });
  expect(res.status).toBe(404);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- contacts`
Expected: FAIL (link route 404s; `detail.body.contacts` is undefined).

- [ ] **Step 3: Include contacts on application detail in `applications.service.js`**

Replace the existing `getById` function with:
```javascript
async function getById(userId, id) {
  const app = await prisma.application.findFirst({
    where: { id, userId },
    include: {
      company: { select: { id: true, name: true } },
      contactLinks: {
        include: {
          contact: {
            select: { id: true, name: true, position: true, company: { select: { id: true, name: true } } },
          },
        },
      },
    },
  });
  if (!app) throw new NotFoundError('Application not found');
  const { contactLinks, ...rest } = app;
  return { ...rest, contacts: contactLinks.map((l) => l.contact) };
}
```
(Leave `list`, `create`, `update`, `updateStatus`, `remove` and `includeCompany` unchanged.)

- [ ] **Step 4: Add link/unlink handlers to `applications.controller.js`**

Add this require at the top, beside `const service = require('./applications.service');`:
```javascript
const contactsService = require('../contacts/contacts.service');
```
Add these two functions:
```javascript
async function linkContact(req, res, next) {
  try {
    res.status(201).json(await contactsService.linkApplication(req.userId, req.params.id, req.body.contactId));
  } catch (e) { next(e); }
}
async function unlinkContact(req, res, next) {
  try {
    await contactsService.unlinkApplication(req.userId, req.params.id, req.params.contactId);
    res.status(204).end();
  } catch (e) { next(e); }
}
```
Add `linkContact, unlinkContact` to the `module.exports` list.

- [ ] **Step 5: Add the nested routes to `applications.routes.js`**

Add the schema import beside the existing schema require:
```javascript
const { linkContactSchema } = require('../contacts/contacts.schema');
```
Add these routes (after the `delete('/:id', ...)` line):
```javascript
router.post('/:id/contacts', validate(linkContactSchema), ctrl.linkContact);
router.delete('/:id/contacts/:contactId', ctrl.unlinkContact);
```

- [ ] **Step 6: Run to verify pass**

Run: `npm test -- contacts`
Expected: PASS (all link/unlink/detail tests green).

- [ ] **Step 7: Run the full suite (no regressions)**

Run: `npm test`
Expected: PASS — all suites, including auth/companies/applications/interviews/dashboard, plus the new contacts suite.

- [ ] **Step 8: Commit**

```bash
git add src/modules/applications tests/contacts.test.js
git commit -m "feat(contacts): application link/unlink + contacts on application detail

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

- **Spec coverage:** Contact model + fields (Task 1) ✓; ApplicationContact join + unique (Task 1) ✓; CRUD + `?search` over name/email + company include (Task 2) ✓; company link/clear via nullable companyId (Task 2) ✓; validation name/email/url (Task 2) ✓; auth + cross-user isolation (Tasks 2–3) ✓; link/unlink + duplicate-409 + cross-user 404 (Task 3) ✓; application detail includes contacts (Task 3) ✓; detail includes linked applications (Task 2 `getById` returns `applications`) ✓.
- **Placeholder scan:** none — every step has full code/commands.
- **Type consistency:** `assertContact`/`assertApplication`/`assertCompany` signatures consistent; `linkApplication(userId, applicationId, contactId)` / `unlinkApplication(...)` names match between service, controller, and exports; relation field names (`applicationLinks`, `contactLinks`) match schema and includes; the `applicationId_contactId` compound-unique key name matches the `@@unique([applicationId, contactId])`.

## Done When

`npm test` is green (existing 45 + new contacts tests), the migration is committed, and `feat/contacts` holds three commits (schema, CRUD, linking). The FE plan consumes: `GET/POST/GET:id/PATCH/DELETE /api/contacts`, `POST /api/applications/:id/contacts`, `DELETE /api/applications/:id/contacts/:contactId`, and `contacts: [...]` on `GET /api/applications/:id`.
