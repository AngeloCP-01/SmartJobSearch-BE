# Reminders (v2) — Design Spec

**Date:** 2026-06-23
**Status:** Approved
**Builds on:** v1, v1.5, v2 Contacts, and v2 Analytics. Backend + frontend both on `main` (BE 74 tests, FE 62 tests).

## Purpose

A job seeker needs nudges, not just records: which interviews are coming up (or already happened and still need an outcome recorded), and which recruiters are due for a follow-up. v2's third slice adds an **in-app Reminders** surface that consolidates the time-relevant items already implied by the data (`Interview.scheduledAt` + `Contact.followUpDate`) into one actionable page, with a count badge in the sidebar. It is computed on demand from existing data — **no background job queue, no email/push** (consistent with the v2 constraint).

## Scope

**IN:**
- New read-only backend **`reminders/`** module: one composite `GET /api/reminders` returning grouped, `userId`-scoped reminders + counts.
- A small **contacts schema tweak** so `PATCH /api/contacts/:id { followUpDate: null }` clears a follow-up (enables the "mark done" action; good hygiene regardless). No DB migration.
- New frontend **Reminders page** (`/reminders`, sidebar nav directly after Dashboard) with a **count badge** on the nav item, grouped lists, a "Mark done" quick action on follow-ups, and soft deep-links to the relevant page.

**OUT (deferred):** email/push notifications, a job queue/BullMQ, dismiss/snooze persistence (no schema for reminder state), opening a specific contact/interview drawer by URL (rows link to the page), reminder preferences/settings, and any change to the existing Dashboard "Upcoming interviews" card (it stays as-is).

## Data

No new models, no migration. Reminders are **derived** from existing v1/v2 data, all filtered by `userId`:
- `Interview`: `scheduledAt` (nullable), `result` (enum `Pending`/`Passed`/`Failed`, nullable), `type`, `applicationId`. Related `application { id, position, company { id, name } }`.
- `Contact`: `followUpDate` (nullable), `name`, `position`, related `company { id, name }`.

Rows with a **null** date are never reminders.

## Backend Changes

### New module `src/modules/reminders/`

Follows the established layering (routes → controller → service), JWT-protected like the other modules; the service takes `userId` and filters every query by it. Wired into the app router at `/api/reminders`. Mirrors the read-only composition style of `dashboard.service` / `analytics.service` (`Promise.all` of independent queries).

#### Endpoint

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/reminders` | Composite reminders payload for the authenticated user |

#### Time semantics

`now = new Date()`; `windowEnd = now + 7 days` (7 × 24 × 60 × 60 × 1000 ms). All comparisons use these `Date` bounds via Prisma `where` filters (datetime comparisons — no date/string math, no timezone gymnastics).

#### Buckets (all `userId`-scoped; null dates excluded)

| Bucket | Filter | Order |
|---|---|---|
| `interviews.upcoming` | `scheduledAt >= now AND scheduledAt <= windowEnd` | `scheduledAt asc` (soonest first) |
| `interviews.overdue` | `scheduledAt < now AND (result = null OR result = 'Pending')` | `scheduledAt desc` (most recent first) |
| `followUps.due` | `followUpDate <= now` | `followUpDate asc` (most overdue first) |
| `followUps.upcoming` | `followUpDate > now AND followUpDate <= windowEnd` | `followUpDate asc` (soonest first) |

#### Response shape

```jsonc
{
  "interviews": {
    "upcoming": [
      { "id": "…", "type": "Technical", "scheduledAt": "2026-06-25T14:00:00.000Z", "result": null,
        "application": { "id": "…", "position": "Backend Engineer", "company": { "id": "…", "name": "Acme" } } }
    ],
    "overdue": [ /* same item shape */ ]
  },
  "followUps": {
    "due": [
      { "id": "…", "name": "Jane Recruiter", "position": "Technical Recruiter",
        "followUpDate": "2026-06-20T00:00:00.000Z", "company": { "id": "…", "name": "Acme" } }
    ],
    "upcoming": [ /* same item shape */ ]
  },
  "counts": { "total": 7, "interviews": 4, "followUps": 3 }
}
```

- `application.company` is `null` when the application has no company; `company` on a follow-up is `null` when the contact has no company.
- `counts.interviews` = upcoming + overdue lengths; `counts.followUps` = due + upcoming lengths; `counts.total` = the sum of all four. The frontend badge uses `counts.total`.

#### Prisma shape

- Interviews: `prisma.interview.findMany({ where: { userId, scheduledAt: {…} , …result }, orderBy, include: { application: { select: { id: true, position: true, company: { select: { id: true, name: true } } } } } })`.
- Follow-ups: `prisma.contact.findMany({ where: { userId, followUpDate: {…} }, orderBy, include: { company: { select: { id: true, name: true } } }, select/shape to { id, name, position, followUpDate, company } })`.
- Overdue interview `result` filter: `{ OR: [{ result: null }, { result: 'Pending' }] }`.

### Contacts schema tweak

In `src/modules/contacts/contacts.schema.js`, change `followUpDate` from `z.coerce.date().optional()` to **`z.coerce.date().nullable().optional()`** (matching the existing `companyId` nullable-optional pattern). `null` then validates and the existing `contacts.service.update` passes it straight to `prisma.contact.update`, clearing the column. (`z.coerce.date()` alone rejects/mangles `null` — it would coerce to the epoch.) No controller/service change needed.

### Backend tests (TDD)

**`tests/reminders.test.js`** (Jest + Supertest, real DB):
- **Auth:** `GET /api/reminders` without a token → `401`.
- **Empty user:** all four buckets `[]`, `counts` all `0`.
- **Categorization:** seed for one user —
  - an interview `scheduledAt` ~2 days ahead (→ `interviews.upcoming`),
  - an interview ~30 days ahead (→ excluded, beyond window),
  - an interview ~2 days in the past with `result` unset/`Pending` (→ `interviews.overdue`),
  - an interview in the past with `result: 'Passed'` (→ excluded),
  - a contact `followUpDate` ~3 days in the past (→ `followUps.due`),
  - a contact `followUpDate` ~3 days ahead (→ `followUps.upcoming`),
  - a contact `followUpDate` ~30 days ahead (→ excluded),
  - a contact with `followUpDate: null` (→ excluded);
  assert each lands in the right bucket, the interview item includes `application.position` + `company.name`, and `counts` match (`interviews: 2, followUps: 2, total: 4`).
- **Cross-user isolation:** user B's interviews/contacts never appear for user A.

**`tests/contacts.test.js`** (extend): `PATCH /api/contacts/:id` with `{ followUpDate: null }` returns 200 and the contact's `followUpDate` is `null` afterward.

## Frontend Changes

### Reminders page (`/reminders`)

- New **sidebar nav item** "Reminders" (lucide `Bell` icon), placed **directly after Dashboard** (before Analytics). Order: Dashboard → Reminders → Analytics → Applications → Companies → Contacts → Interviews.
- New route `/reminders` (guarded like other authenticated routes), page `src/pages/Reminders.jsx`.
- **Nav badge:** the sidebar (`Layout.jsx`) runs `useQuery(['reminders'])` and, when `data.counts.total > 0`, renders a small rounded badge with the total on the Reminders nav item. Shared cache with the page (same key), so it's one request.
- **Layout** (cards per DESIGN.md: `rounded-xl border border-sky-100 bg-white shadow-sm`):
  - **Interviews** card with two subsections, **Upcoming** and **Overdue** (each rendered only when non-empty). Each row: `type` · application `position` · `company.name`, formatted `scheduledAt`; the Overdue subsection rows show an **amber pill** ("overdue"). Rows are `Link`s to `/interviews`.
  - **Follow-ups** card with **Due** and **Upcoming** subsections. Each row: contact `name` · `position`/`company.name`, formatted `followUpDate`; Due rows show an **amber pill**, Upcoming rows a **sky pill**. Each row has a **"Mark done"** button and links to `/contacts`.
- **"Mark done"** → `updateContact(contactId, { followUpDate: null })` (existing `src/api/contacts.js`); on success invalidate `['reminders']` and `['contacts']`. The row disappears on refetch.
- **States:** loading ("Loading…"); **empty** when `counts.total === 0` → friendly "You're all caught up — no reminders right now."; error banner (`role="alert"`, matching existing pages).

### API & query keys

- New FE API module `src/api/reminders.js`: `fetchReminders()` → `GET /api/reminders`.
- Query key `['reminders']` (page + Layout badge). The only mutation reuses `updateContact` from `src/api/contacts.js`.
- Built with the **ui-ux-pro-max** skill against DESIGN.md tokens.

### Frontend tests (Vitest + RTL + MSW)

- **Reminders page:** renders all four groups from a mock payload (interview type/position/company + date; follow-up name + date); the Overdue/Due rows show the overdue label/styling; **"Mark done"** issues `PATCH /api/contacts/:id` with `{ followUpDate: null }` and the list refetches; **empty** state shows when `counts.total === 0`; **loading** and **error** states render.
- **Layout:** renders a "Reminders" nav link and, given a mocked `['reminders']` with `counts.total > 0`, shows the badge count.
- MSW handlers for `GET /api/reminders` and `PATCH /api/contacts/:id`, matching the backend response/enum shapes.

## Architecture Notes

- The `reminders/` backend module is a self-contained read-only vertical slice: routes own URL/middleware, controller owns HTTP, service owns all Prisma/bucketing logic keyed by `userId`. No writes, no schema/DB migration (only a Zod-validation widening on contacts).
- Reminders are **stateless/derived** — there is no stored reminder or dismissed flag. "Acting on" a reminder means editing the underlying record (clear a contact's `followUpDate`, or record an interview outcome elsewhere), which naturally removes it from the next fetch. This keeps the slice small and avoids a reminder-state model the product doesn't yet need.
- The "mark done" action reuses the existing contacts update contract rather than adding a reminders-specific mutation; the only backend change it requires is allowing `followUpDate: null` through validation.
- The Reminders page and the sidebar badge share the `['reminders']` query, so the badge costs no extra request.

## Success Criteria

A signed-in user can open **Reminders** from the sidebar (with a badge showing how many items need attention) and see, in grouped lists: interviews coming up in the next 7 days, past interviews still needing an outcome, follow-ups that are due/overdue, and follow-ups coming up in the next 7 days — all from their own data. They can clear a follow-up inline with "Mark done", and jump to the relevant page for anything else. All covered by backend (bucketing correctness + isolation + the null-clear) and frontend (rendering + states + the mark-done mutation) tests.
