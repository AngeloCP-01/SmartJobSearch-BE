# List Pagination across Five Modules (`/api/v2`) — Design

Date: 2026-08-13
Scope: **backend only.** Frontend migration is a separate, later piece of work.
Modules: `applications`, `analysis`, `companies`, `contacts`, `activity`.

## Motivation

Every list endpoint except `activity` returns **every row the user owns**. `applications`,
`analysis`, `companies`, and `contacts` all call `findMany` with no `take`/`skip`:

```js
// applications.service.js:13
const list = (userId, { status } = {}) =>
  prisma.application.findMany({
    where: { userId, ...(status ? { status } : {}) },
    orderBy: { createdAt: 'desc' },
    include: includeCompany,
  });
```

The frontend then filters, searches, and sorts the whole array in memory. For a job
tracker this has not hurt yet — a heavy user has hundreds of applications, not millions —
but the cost is unbounded in the row count, and there is no ceiling anywhere in the stack.

## The real risk is cache keys, not SQL

The naive change — make the list endpoint paginate — silently breaks four dropdowns.

`listApplications()` is consumed by **five** frontend pages: `Applications`, `Analysis`,
`Interviews`, `TailorResume`, `CoverLetter`. The last four use it to populate a
"pick an application" `<select>`, and **all five share the react-query key
`['applications']`**. `listCompanies()` / `listContacts()` are worse: they feed both the
page lists *and* the `ApplicationDrawer` / `ContactDrawer` dropdowns under
`['companies']` / `['contacts']`.

If a paginated subset lands in those keys, the dropdowns show only page 1. The user sees a
short list, assumes the application isn't there, and creates a duplicate. It presents as
missing data, not as a pagination bug, and no current test would catch it.

This is why the work is versioned rather than in-place: **v1 keeps returning everything**,
so nothing breaks until the frontend explicitly opts in per call site.

## Decision: `/api/v2`, a complete surface

The app already mounts the same router at two prefixes (`src/app.js:44`):

```js
for (const base of ['/api/v1', '/api']) {
  app.use(base, apiLimiter);
  app.use(`${base}/auth`, authLimiter);
  app.use(base, routes);
}
```

Versioned mounting is therefore an existing pattern, not new infrastructure.

`/api/v2` exposes the **full** module surface — `/api/v2/applications/:id` behaves exactly
as v1 — so the frontend migrates by changing one base URL rather than routing per-endpoint.
Only the five list handlers differ.

### Registration order is load-bearing

v2 must be registered **before** the existing loop:

```js
app.use('/api/v2', apiLimiter);
app.use('/api/v2/auth', authLimiter);
app.use('/api/v2', v2Routes);
for (const base of ['/api/v1', '/api']) { /* unchanged */ }
```

`app.use('/api', …)` prefix-matches `/api/v2/...` as well. Express runs every matching
`app.use` in registration order until a response is sent, so if v2 were registered last,
each v2 request would pass through `apiLimiter` **twice** and get half the intended rate
budget. Registering v2 first means the v2 router responds before the `/api` chain runs.

## Decision: offset for tables, cursor for the feed

Two strategies, chosen by data shape rather than for uniformity:

| Modules | Strategy | Envelope |
|---|---|---|
| applications, analysis, companies, contacts | offset (`page`, `pageSize`) | `{ items, page, pageSize, total, totalPages }` |
| activity | cursor (`before`, `pageSize`) | `{ items, pageSize, nextCursor }` |

Offset suits numbered tables: users want "page 3 of 12" and a total count, and rows are
stable between requests.

`activity` is an append-only feed driving infinite scroll, and it **already** paginates by
cursor (`activity.service.js:23`). Offset over a feed that grows at the *top* duplicates
and skips rows — row 25 becomes row 26 the moment a new event lands, so paging to offset
25 re-serves a row already shown. Cursors are correct there and stay.

Activity still honours the same page-size allowlist, but **v2 names the parameter
`pageSize`** for consistency with the other four; v1 keeps its existing `limit`. It does not
expose `total`/`totalPages`, because counting an append-only log on every request buys
nothing the client uses.

Both envelopes share `items` and `pageSize`.

Column names in this document are verified against `prisma/schema.prisma` — notably the
applications date column is **`applicationDate`**, not `appliedDate`.

## Page size

Allowlist **10 / 25 / 50 / 100**, default **25**.

An out-of-list value returns **400**, it is not clamped. An allowlist that silently accepts
`pageSize=7` and returns 10 is not a contract — the client cannot tell whether it got what
it asked for. This deliberately differs from the existing activity behaviour, which clamps
(`Math.min(Math.max(parseInt(limit) || 50, 1), 100)`); v1 activity keeps clamping, v2
validates.

## Architecture: one service, two presenters

Each module keeps a **single** `list()`. It returns `{ items, total }` internally; the
controllers decide how to present it.

```
service.list(userId, { ...filters, skip, take })  ->  { items, total }
                    |                                        |
        v1 controller: res.json(items)      v2 controller: res.json(toOffsetEnvelope(...))
```

- **Without `take`**: no `skip`/`take` on the query, and **no count query** —
  `total = items.length`. v1 must not start paying for a `COUNT(*)` it never reads.
- **With `take`**: `prisma.$transaction([findMany(...), count({ where })])` so `items` and
  `total` are consistent, and `total` reflects the **filtered** set rather than the table.

Filters, `where` clauses, and `include`s therefore have exactly one home. The alternative
considered — duplicate v2 services — was rejected: two copies drift the first time either
is edited, the same failure mode that motivated extracting `engine/prompts.js` in V3-25.

The residual risk of this approach is that **v1 and v2 route wiring** can drift. That is
confined to `routes/index.js` / `routes/v2.js` and is the thing to watch in review.

## Shared module: `src/shared/pagination.js`

One home for the allowlist rather than five copies of the same clamp:

- `offsetQuerySchema` / `cursorQuerySchema` — Zod, used through the **existing**
  `validate(schema, 'query')` middleware, which already supports a `'query'` source.
- `toOffsetEnvelope({ items, total, page, pageSize })` → adds `totalPages`.
- `toCursorEnvelope({ items, pageSize, nextCursor })`.

`totalPages` is `Math.ceil(total / pageSize)`, and **0 when `total` is 0** (not 1) — an
empty list has no pages, and a client rendering "Page 1 of 1" over nothing is misleading.

## Per-module parameters

| Module | Filters | Sortable |
|---|---|---|
| applications | `status`, `companyId`, `search` (position + company name) | `position`, `company`, `status`, `applicationDate`, `createdAt` |
| analysis | — | `createdAt`, `atsScore`, `matchScore` |
| companies | `search` (name) — existing | `name`, `createdAt` |
| contacts | `search` (name, email) — existing | `name`, `createdAt` |
| activity | `applicationId` — existing | fixed `createdAt desc, id desc` (cursor order) |

`sort` maps through a **whitelist** rather than passing user input into `orderBy`; `company`
resolves to `{ company: { name: dir } }`. `dir` is `asc`/`desc`, default `desc`.
Unknown sort key → 400.

### Constraint: analysis cannot sort or search on `documentName` / `position`

Those two fields are not columns. They are read out of `report.meta` JSON at
`analysis.service.js:124-128`:

```js
documentName: r.report?.meta?.documentName ?? null,
position:     r.report?.meta?.position ?? null,
```

Sorting them in SQL requires JSON path expressions, and searching them requires an
expression index to avoid a full scan of every stored report. Neither is justified by this
work. Analysis therefore sorts on real columns only.

Promoting these to first-class columns is a schema migration + backfill, tracked as a
follow-up. Stated here rather than shipped as a search box that quietly misses rows.

## Error handling

Invalid `pageSize`, `page`, `sort`, or `dir` → **400** `VALIDATION` through the existing
`ValidationError` and error envelope, with per-field `details` from the Zod issue list.

`page` beyond the last page returns `items: []` with a truthful `total`. That is a valid
empty page, not a 404 — a client on page 5 when rows are deleted should see an empty page
and a total it can use to recover, not an error.

## Testing

Written test-first, per the repo's TDD workflow.

Per offset module:
- default `page`/`pageSize` when the client sends neither
- `pageSize` allowlist: 10/25/50/100 accepted, `7` rejected 400
- slicing correct across page boundaries; partial last page
- **`total` is the filtered count, not the table count** — the easy bug, asserted with a
  filter that excludes rows
- page past the end → empty `items`, correct `total`
- unknown `sort` key → 400
- **v1 regression: the bare array response is byte-identical to today**

Activity:
- `nextCursor` is null on the final page
- no duplicate ids across consecutive pages
- v1 clamping behaviour unchanged

Cross-cutting:
- every v2 list endpoint rejects `pageSize=7` (guards a module wired without the shared schema)
- v2 non-list routes (`/api/v2/applications/:id`) behave as v1
- a v2 request increments the rate limiter **once**, not twice (guards the registration-order
  hazard above, which is otherwise invisible until production)

## Performance notes (no migration in this work)

Existing indexes are uneven, and the design does not add any:

- `ResumeAnalysis` and `ActivityLog` have `@@index([userId, createdAt])` — the default
  sort is index-covered.
- `Application`, `Company`, `Contact` have only `@@index([userId])`, so the default
  `createdAt desc` needs a sort step, and sorting by `position`/`name` certainly does.

At current row counts (hundreds per user) this is irrelevant, and adding composite indexes
speculatively is unjustified. It is recorded because pagination adds a **second** query per
request (`COUNT(*)` alongside `findMany`), so a paginated request is not strictly cheaper
than the unpaginated one it replaces — it trades a large payload for two indexed queries.
The win is a bounded response and bounded memory on the client, not fewer database round
trips. If a list ever gets slow, the composite index is the first move, not a redesign.

## Implementation sequencing

Build as a vertical slice, not module-by-module in parallel:

1. `src/shared/pagination.js` + its unit tests (schemas, envelopes, `totalPages` at 0).
2. `applications` end-to-end through v2 routing — the hardest module (relation sort,
   two-field search) and the one that proves the routing, the limiter-order hazard, and
   the v1-unchanged regression test.
3. Then `companies`, `contacts`, `analysis` — mechanical repeats of the proven shape.
4. `activity` last, since it is the only cursor module and shares least with the others.

Step 2 is the gate: if the shape is wrong, it is wrong once rather than five times.

## Non-goals (deferred)

- **All frontend work.** No react-query key changes, no page-size selector UI, no pager.
- **The Kanban board.** It needs every row to populate its columns and to drag between
  them; it stays on the unpaginated call deliberately.
- **`documentName` / `position` as columns** on `ResumeAnalysis` (migration + backfill).
- **Retiring v1.** Both versions live until the frontend has fully migrated.
- Cursor pagination for the four offset modules.

## Related

- `TASKS.md` / `TRACKER.md` — V3-28
- V3-25 (`engine/prompts.js` extraction) — precedent for rejecting duplicated logic
- `src/shared/middleware/validate.js` — the `'query'` source this design relies on
