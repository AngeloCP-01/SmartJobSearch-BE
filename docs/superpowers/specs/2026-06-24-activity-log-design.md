# Activity Log & Timeline (v3) — Design Spec

**Date:** 2026-06-24
**Status:** Approved
**Builds on:** v1, v1.5, v2 (Contacts, Analytics, Reminders), and v3-1 (Documents). Backend + frontend both on `main` (BE 97 tests, FE 84 tests).

## Purpose

A job seeker wants to see the story of each application — when it was created, how its status moved, which interviews were scheduled and how they went, and which documents/contacts were attached — plus a single cross-cutting feed of recent activity. v3's second slice (V3-2) adds an **Activity Log**: an append-only, per-user audit trail written at key write points, surfaced as both a **per-application timeline** (in the application drawer) and a **global `/activity` feed**. It fulfils the initial doc's "Activity Log" module and the Applications "History / Timeline Tracking" feature.

## Scope

**IN:**
- New backend **`activity/`** module: a shared `record(...)` write helper used by other modules, and one read endpoint `GET /api/activity` (filterable by application, cursor-paginated), all `userId`-scoped.
- **Explicit logging** at a curated set of write points (no auto-logging, no backfill of historical data).
- One new **`ActivityLog` table** (real migration).
- Frontend **`/activity` global feed page** (sidebar, after Documents) + an **Activity timeline section** in the application drawer, sharing one render helper.

**OUT (deferred):** logging plain field edits (notes/salary/etc.), company/document/contact CRUD outside the linked-to-application events, unlink/delete-of-sub-entity events, editing or deleting log entries, retroactive backfill of pre-existing data, per-event read receipts, and real-time push (the feed refreshes on query invalidation, not via websockets).

## Data

One new model (real migration), per-user. No change to existing models except a new back-relation on `User` and `Application`.

### `ActivityLog`
| Field | Type | Notes |
|---|---|---|
| `id` | String (uuid) | PK |
| `userId` | String | owner; `onDelete: Cascade` from `User` |
| `action` | enum `ActivityAction` | see below |
| `applicationId` | String? | nullable FK to `Application`, **`onDelete: SetNull`** — the grouping key for the per-app timeline; nullable so a log survives its application being deleted |
| `metadata` | Json | denormalized snapshot so the event renders without the live entity (default `{}`) |
| `createdAt` | DateTime | `@default(now())`; feed ordering key |

Indexes: `@@index([userId, createdAt])` (global feed), `@@index([applicationId])` (per-app timeline).

### `ActivityAction` enum
`ApplicationCreated`, `ApplicationStatusChanged`, `ApplicationDeleted`, `InterviewScheduled`, `InterviewResultRecorded`, `DocumentLinked`, `ContactLinked`.

### `metadata` shapes (by action)
- `ApplicationCreated`: `{ position }`
- `ApplicationStatusChanged`: `{ position, from, to }` (status enum values)
- `ApplicationDeleted`: `{ position }` (logged with `applicationId: null`)
- `InterviewScheduled`: `{ position, type, scheduledAt }`
- `InterviewResultRecorded`: `{ position, type, result }`
- `DocumentLinked`: `{ position, name }`
- `ContactLinked`: `{ position, name }`

`position` is included on every event so the **global feed** can name the application even when filtering is off (and after deletion). Relations: `Application` gains `activityLogs ActivityLog[]`; `User` gains `activityLogs ActivityLog[]`.

## Backend Changes

### New module `src/modules/activity/`
Layering routes → controller → service like the other modules; JWT-protected; every query filters by `userId`. The service exposes both the **write helper** (consumed by other modules) and the **read** path. `activity.service` depends only on `prisma` — the other services depend on it, so there is no dependency cycle.

#### Write helper
```
record(userId, action, { applicationId = null, metadata = {} }) -> Promise<void>
```
Inserts one row. Called with `await` immediately after the entity write succeeds, in the same request (a failed log fails the action — consistent and test-visible). Call sites (one line each):

| Service / method | Action | `applicationId` | `metadata` |
|---|---|---|---|
| `applications.service.create` | `ApplicationCreated` | new app id | `{ position }` |
| `applications.service.updateStatus` (only when status actually changes) | `ApplicationStatusChanged` | app id | `{ position, from, to }` |
| `applications.service.remove` (after delete) | `ApplicationDeleted` | `null` | `{ position }` |
| `interviews.service.create` | `InterviewScheduled` | `data.applicationId` | `{ position, type, scheduledAt }` |
| `interviews.service.update` (only when `result` transitions to `Passed`/`Failed`) | `InterviewResultRecorded` | interview's `applicationId` | `{ position, type, result }` |
| `documents.service.linkApplication` | `DocumentLinked` | app id | `{ position, name }` |
| `contacts.service.linkApplication` | `ContactLinked` | app id | `{ position, name }` |

Detecting transitions reuses existing reads: `applications.updateStatus`/`interviews.update` already fetch the prior row via `getById` — capture its return (`const existing = await getById(...)`) to compare `existing.status`/`existing.result` and to read `position`/`type`. Where `position` isn't already loaded, the service fetches it (it has the application id).

#### Read endpoint
| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/activity` | The user's events, newest-first |

Query params: `applicationId` (filter → per-app timeline), `limit` (default 50, clamped 1–100), `before` (ISO `createdAt` cursor; returns rows strictly older). Response:
```jsonc
{
  "items": [
    { "id": "…", "action": "ApplicationStatusChanged", "applicationId": "…",
      "metadata": { "position": "Backend Engineer", "from": "Applied", "to": "Technical_Interview" },
      "createdAt": "2026-06-24T01:00:00.000Z" }
  ],
  "nextCursor": "2026-06-24T00:30:00.000Z"  // createdAt of the last item when more may exist, else null
}
```
`nextCursor` is non-null only when the page returned a full `limit` (more may remain). Per-app reads (`applicationId` set) are small and the frontend ignores `nextCursor` there.

### Backend tests (TDD)
**`tests/activity.test.js`** (Jest + Supertest, real DB):
- Auth: `GET /api/activity` without a token → 401.
- Each call site writes exactly one expected event: create application → `ApplicationCreated`; change status → `ApplicationStatusChanged` `{from,to}` (and **no** event when status is set to its current value); schedule interview → `InterviewScheduled`; PATCH interview to `Passed` → `InterviewResultRecorded` (and **none** on a notes-only edit); link document → `DocumentLinked`; link contact → `ContactLinked`; delete application → `ApplicationDeleted` survives with `applicationId: null` and `metadata.position` intact.
- Ordering newest-first; `?applicationId=` returns only that app's events; `?limit=`/`?before=` paginate and `nextCursor` advances.
- Isolation: user B never sees user A's activity.

`tests/helpers/db.js` `resetDb` adds `prisma.activityLog.deleteMany()` (before `application`/`user`).

## Frontend Changes

### Global feed — `/activity` page
- New **sidebar nav item** "Activity" (lucide `History`), placed **directly after Documents**. Route guarded like other authenticated pages; page `src/pages/Activity.jsx`.
- `useQuery(['activity'])` → `GET /api/activity`. Events **grouped by day** ("Today", "Yesterday", then formatted dates); each row = an icon + a human sentence + relative time, the row linking to `/applications` (the relevant application). **"Load more"** button uses `nextCursor` (`before=`), appending results. Loading / empty ("No activity yet") / error (`role="alert"`) states.

### Per-application timeline — application drawer
- A new **Activity** section in `ApplicationDrawer.jsx` (alongside Interviews / Contacts / Documents). `useQuery(['activity', application.id])` → `GET /api/activity?applicationId=<id>`. A compact vertical timeline (same row renderer; no "load more"). Empty → "No activity yet."

### Shared rendering
- `src/lib/activityCopy.js`: a pure helper mapping `(action, metadata)` → `{ icon, text }` (e.g. `ApplicationStatusChanged` → "Moved **{position}** from {from} to {to}" with status labels humanized; `DocumentLinked` → "Attached **{name}** to {position}"). Reused by the page and the drawer so the icon/sentence logic isn't duplicated.
- `src/components/ActivityList.jsx` (or a row component) renders an array of items using `activityCopy`.

### API & query keys
- New FE API module `src/api/activity.js`: `fetchActivity({ applicationId, before } = {})` → `GET /api/activity`.
- Query keys `['activity']` (global) and `['activity', applicationId]` (per-app). The mutations that produce logged events — application status change, interview create + result update, document link, contact link, application create/delete — **also invalidate `['activity']`** (and the per-app key where an `applicationId` is in scope) so both surfaces refresh.
- Built with the **ui-ux-pro-max** skill against `DESIGN.md` (timeline rail, slate text, sky accents, lucide icons).

### Frontend tests (Vitest + RTL + MSW)
- **`activityCopy` unit tests:** each `action` + metadata → expected sentence + icon (pure, fast).
- **Activity page:** renders day-grouped events from a mock payload with correct sentences; loading / empty / error; **"Load more"** issues a `before=` request and appends.
- **Drawer timeline:** given `['activity', appId]`, renders that app's events; empty state.
- A default `GET /api/activity` MSW handler is added to `src/test/server.js` so existing drawer tests don't error once the drawer queries it.

## Architecture Notes

- The `activity/` module is a self-contained slice: it owns the log table, the write helper, and the read endpoint. Other modules depend on it one-directionally (they call `record`); it depends only on `prisma`, so there is no cycle.
- Events store **denormalized snapshots** in `metadata` (position, names, status labels), so the audit trail renders correctly even after the underlying entity is edited or deleted, and the frontend can render each event without extra fetches.
- The **frontend renders the human sentence** from structured `(action, metadata)` via one shared helper — the backend stays data-only, and copy/format changes don't require a migration.
- One filterable endpoint serves both surfaces (`applicationId` present → per-app timeline; absent → global feed), keeping the read path single and consistent.

## Success Criteria

A signed-in user sees, on a new **Activity** page, a day-grouped feed of their recent events ("Created Backend Engineer", "Moved … to Technical Interview", "Scheduled a Technical interview", "Recorded Passed", "Attached Resume v2", "Added Jane Recruiter"), with "Load more" paging older entries; and, inside any application's drawer, a timeline of just that application's events. Events are recorded automatically at the defined write points, are strictly per-user, store readable snapshots that survive edits/deletes, and are covered by backend tests (each call site fires the right single event + filtering/pagination/isolation) and frontend tests (copy helper + page states + drawer timeline).
