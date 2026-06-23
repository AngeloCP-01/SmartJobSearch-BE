# Analytics (v2) — Design Spec

**Date:** 2026-06-23
**Status:** Approved
**Builds on:** v1 (`2026-06-22-job-search-crm-v1-design.md`), v1.5 (`2026-06-23-application-details-design.md`), and v2 Contacts (`2026-06-23-contacts-design.md`). Backend + frontend both on `main` (BE 69 tests, FE 55 tests).

## Purpose

Job seekers want to see how their search is going, not just the raw list. v2's second slice adds an **Analytics** page: a small set of headline metrics plus two charts that turn the existing application/interview data into insight. It is a read-only vertical slice — a new backend aggregation module (no schema change) plus a new frontend page with a charting library — that builds on the existing `dashboard/summary` pattern with richer, `userId`-scoped aggregations.

## Scope

**IN:**
- New backend **`analytics/`** module: a single composite endpoint `GET /api/analytics` returning headline metrics, a status-distribution ("pipeline") breakdown, and applications-over-time.
- New frontend **Analytics page** (`/analytics`, sidebar nav directly after Dashboard): four metric cards + a pipeline bar chart + an applications-over-time area chart, using **Recharts**.

**OUT (deferred to a later Analytics follow-up):** most-active-companies report, success-rate-by-source report, a separate interview-conversion-rate chart, date-range selectors/filters, CSV export, and any caching/Redis. No database schema change in this slice.

## Key Decisions

- **Charting library: Recharts.** Declarative composable React/SVG components, `<ResponsiveContainer>` for responsiveness, easy to theme to the DESIGN.md sky/green palette; covers bar + area out of the box. (Considered Chart.js — canvas, imperative, harder to theme; Nivo — heavier d3 bundle than needed.)
- **Page placement: a dedicated `/analytics` page**, not an extension of the Dashboard, so the Dashboard stays a fast at-a-glance overview and Analytics is the deeper drill-down. Sidebar order: **Dashboard → Analytics → Applications → Companies → Contacts → Interviews.**
- **Endpoint shape: one composite `GET /api/analytics`** returning `{ metrics, funnel, overTime }`. The page loads everything at once, it mirrors the existing `dashboard/summary` precedent (one loading/error state, one cache key), and it is easy to split into focused endpoints later if needed.
- **First-cut scope:** the four headline metrics + pipeline distribution + applications-over-time. Other reports/charts from INITIAL_DOC are deferred (YAGNI).

## Data

No new models or migration. Aggregations read existing v1 data, all filtered by `userId`:
- `Application`: `status` (enum: Draft, Applied, HR_Screening, Technical_Interview, Final_Interview, Offer, Accepted, Rejected, Withdrawn), `applicationDate` (nullable), `createdAt`, plus the `interviews` relation.
- `Interview`: linked to an application via `applicationId`; presence (≥1) is what the interview rate uses.

## Backend Changes

New module `src/modules/analytics/` following the established layering (routes → controller → service), JWT-protected like the other modules, the service function taking `userId` and filtering every query by it. Wired into the app router at `/api/analytics`.

### Endpoint

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/analytics` | Composite analytics payload for the authenticated user |

### Response shape

```jsonc
{
  "metrics": {
    "totalApplications": 42,
    "interviewRate": 0.45,   // 0..1 fraction; FE formats as %
    "offerRate": 0.07,       // (Offer 2 + Accepted 1) / 42, reconciles with funnel below
    "rejectionRate": 0.19    // Rejected 8 / 42
  },
  "funnel": [                // exactly 9 entries, canonical pipeline order, zero-filled
    { "status": "Draft", "count": 3 },
    { "status": "Applied", "count": 10 },
    { "status": "HR_Screening", "count": 6 },
    { "status": "Technical_Interview", "count": 5 },
    { "status": "Final_Interview", "count": 3 },
    { "status": "Offer", "count": 2 },
    { "status": "Accepted", "count": 1 },
    { "status": "Rejected", "count": 8 },
    { "status": "Withdrawn", "count": 4 }
  ],
  "overTime": [              // exactly 12 entries, oldest→newest, zero-filled
    { "month": "2025-07", "count": 4 },
    // … through the current month
    { "month": "2026-06", "count": 7 }
  ]
}
```

### Metric definitions

- `totalApplications` = count of the user's applications.
- `interviewRate` = applications with **≥1 Interview record** ÷ total, via `application.count({ where: { userId, interviews: { some: {} } } })`. Counts anyone who actually interviewed, regardless of final outcome (an app interviewed then rejected still counts) — chosen because there is **no status-history/activity-log table**, only each application's current status.
- `offerRate` = (Offer + Accepted) ÷ total.
- `rejectionRate` = Rejected ÷ total.
- All three rates use **total** as the denominator (reconciles with the funnel) and return `0` when total is 0 (no divide-by-zero). Rates are fractions `0..1`; the frontend formats them as percentages.

### Pipeline ("funnel")

A **status-distribution** breakdown, not a literal cumulative funnel: because only current status is stored, an application in `Offer` is counted only under Offer (not also in the earlier stages it passed through), so a true shrinking funnel is not computable. Computed with the existing `groupBy(['status'])` count pattern, then mapped into a fixed array of **all 9 statuses in canonical pipeline order** (Draft → Applied → HR_Screening → Technical_Interview → Final_Interview → Offer → Accepted → Rejected → Withdrawn), zero-filling statuses with no applications.

### Applications over time

Monthly buckets for the **last 12 calendar months** (including the current month), oldest→newest, zero-filled. Each application is bucketed by `COALESCE(applicationDate, createdAt)` so apps without an explicit `applicationDate` still count (by when they were created). Computed with a Postgres `date_trunc('month', …)` raw query via `Prisma.sql` (the `userId` and start-date bound as parameters, never interpolated), then the resulting `{ month, count }` rows are merged into the fixed 12-month skeleton in JS (months with no rows → `count: 0`). `month` is formatted `YYYY-MM`.

### Backend tests (TDD — `tests/analytics.test.js`, Jest + Supertest, real DB)

- **Auth required:** `GET /api/analytics` without a token → `401`.
- **Empty data:** a fresh user → `totalApplications: 0`, all rates `0`, `funnel` is 9 entries all `count: 0` in canonical order, `overTime` is 12 entries all `count: 0`.
- **Metrics math:** seed a known mix of applications (varied statuses) and interviews, assert `interviewRate` (apps with ≥1 interview), `offerRate` (Offer+Accepted), and `rejectionRate` (Rejected) match the expected fractions.
- **Funnel:** assert all 9 statuses present in canonical order with the seeded counts.
- **Over-time:** seed applications across known months (some via `applicationDate`, some via `createdAt` only with `applicationDate` null) and assert they land in the correct monthly buckets, with zero-fill for empty months and exactly 12 entries.
- **Cross-user isolation:** user B's applications/interviews never appear in user A's analytics.

## Frontend Changes

### Analytics page (`/analytics`)

- New **sidebar nav item** "Analytics" (lucide `LineChart` icon), placed **directly after Dashboard** (before Applications).
- New route `/analytics` (guarded like the other authenticated routes), page component `src/pages/Analytics.jsx`.
- **Layout** (on `sky-50`, white `rounded-xl border border-sky-100 shadow-sm` cards per DESIGN.md):
  - **Four metric cards** across the top — Total applications, Interview rate, Offer rate, Rejection rate — reusing the Dashboard `Card` look (icon + label + big tabular number; rates shown as `NN%`).
  - **Pipeline** card: a horizontal **Recharts `<BarChart>`** of count-by-status in canonical order, each bar colored with the per-status hue from DESIGN.md (Draft `slate` … Offer `green` … Rejected `red`).
  - **Applications over time** card: a **Recharts `<AreaChart>`** of the 12 monthly buckets in sky, x-axis = month, y-axis = count.
  - All charts wrapped in `<ResponsiveContainer>`.
- **States:** loading ("Loading…"), error banner (matching the Applications error pattern), and a friendly **empty state** when `totalApplications === 0` ("Add applications to see analytics") instead of empty charts.

### API & query keys

- New FE API module `src/api/analytics.js`: `fetchAnalytics()` → `GET /api/analytics`.
- Query key `['analytics']`, simple `useQuery` (read-only; no mutations, no optimistic updates).
- Add `recharts` to `package.json` dependencies.
- Built with the **ui-ux-pro-max** skill against DESIGN.md tokens.

### Frontend tests (Vitest + RTL + MSW)

- Renders the four metric values from a mocked payload (incl. rates formatted as `%`).
- Renders both chart cards (assert on the accessible card titles / labels and that data drives them — not on SVG internals).
- Loading state shows while fetching; **empty state** shows when `totalApplications === 0`; error state shows on a failed request.
- MSW handler for `GET /api/analytics` returning the exact response shape (metrics + 9-entry funnel + 12-entry overTime), enum values matching the backend.

## Architecture Notes

- The `analytics/` backend module is a self-contained read-only vertical slice: routes own the URL/middleware, the controller owns HTTP, the service owns all Prisma/aggregation logic keyed by `userId`. No writes, no schema change.
- The service composes four independent aggregations (total, interviewed-count, status groupBy, monthly raw query) via `Promise.all`, mirroring `dashboard.service.summary`.
- The over-time raw query is the one place SQL is hand-written; `userId`/date bounds are parameterized through `Prisma.sql` (no string interpolation).
- The Analytics page is a focused read-only component: one query, derived view-model, chart components themed from DESIGN.md tokens. The metric card reuses the Dashboard `Card` visual.

## Success Criteria

A signed-in user can open **Analytics** from the sidebar and see: their total applications, interview/offer/rejection rates, a pipeline breakdown of applications by status, and a 12-month trend of applications over time — all computed only from their own data, with graceful loading/empty/error states, and covered by backend (aggregation correctness + isolation) and frontend (rendering + states) tests.
