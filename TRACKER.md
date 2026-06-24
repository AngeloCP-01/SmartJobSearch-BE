# Backend Tracker (v1)

Status legend: ☐ Not started · ◐ In progress · ☑ Done · ⛔ Blocked

**Last updated:** 2026-06-23
**Master tracker:** `../TRACKER.md`

| ID | Milestone | Status | Notes |
|----|-----------|--------|-------|
| BE-0 | Scaffold | ☑ | Express + Prisma + Docker Postgres (host port 5434), health check |
| BE-1 | Auth | ☑ | register/login/refresh/logout/me; access + refresh (httpOnly cookie) with rotation |
| BE-2 | Companies | ☑ | CRUD + search, per-user isolation |
| BE-3 | Applications + Kanban API | ☑ | CRUD + `PATCH /:id/status` |
| BE-4 | Interviews | ☑ | CRUD linked to applications |
| BE-5 | Dashboard | ☑ | `GET /dashboard/summary` |
| BE-6 | Deploy | ☐ | Railway/Render + managed Postgres (separate session) |

## v1.5 — Application Details (backend slice) ☑ (2026-06-23, merged to `main`)
Application responses now include `company { id, name }`; `PATCH /applications/:id` with `companyId: null` unlinks. (Frontend drawer lives in the FE repo.)

## v2 — Contacts (backend slice) ☑ (2026-06-23, merged to `main`)
New `Contact` model (per-user; optional `companyId` FK; name, email, position, phone, linkedinUrl, notes, followUpDate) + `ApplicationContact` explicit join (unique `[applicationId, contactId]`). New `contacts/` CRUD module (`?search` over name/email, isolation) + `POST/DELETE /api/applications/:id/contacts` link/unlink (duplicate → 409, idempotent unlink, cascade on delete); `GET /api/applications/:id` now includes `contacts`. Spec: `docs/superpowers/specs/2026-06-23-contacts-design.md`; plan: `docs/superpowers/plans/2026-06-23-contacts-backend.md`.

## v2 — Post-Contacts fixes ☑ (2026-06-23, merged to `main`)
- **Auth refresh race:** rotation now uses idempotent `deleteMany` + count guard (concurrent refresh no longer throws Prisma P2025 / 500; racing loser gets a clean 401).
- **Remember me:** login/register accept `rememberMe` (carried in the refresh JWT `rmb` claim, preserved across rotation); checked → 30-day token + persistent cookie, unchecked → 1-day token + session cookie.
- **Application `source`** max raised 200 → 2000 (real job-board URLs).

## v2 — Analytics (backend slice) ☑ (2026-06-23, merged to `main`)
New read-only `analytics/` module: one composite `GET /api/analytics` → `{ metrics, funnel, overTime }`, all `userId`-scoped, no schema change. **Metrics:** `totalApplications`, `interviewRate` (apps with ≥1 interview ÷ total), `offerRate` ((Offer+Accepted) ÷ total), `rejectionRate` (Rejected ÷ total); rates are `0..1`, `0` when total is 0. **Funnel:** count by status, all 9 statuses in canonical order, zero-filled. **overTime:** last 12 months, bucketed by `COALESCE(applicationDate, createdAt)` via a parameterized `date_trunc` raw query, zero-filled. Spec: `docs/superpowers/specs/2026-06-23-analytics-design.md`; plan: `docs/superpowers/plans/2026-06-23-analytics-backend.md`. **Reviewed (read-only subagent) — Approved, no blocking;** non-blocking polish in `86c676b` (commented the `date_trunc` query's UTC/`timestamp`-without-tz dependency; test imports `monthKeys` instead of duplicating it).

## Tests
74 passing across 10 suites (adds the `analytics` suite: 401, empty-shape, metrics+funnel, over-time bucketing w/ createdAt fallback, cross-user isolation).

## In Flight
_v2 complete; **v3 in progress** — Documents (V3-1) + Activity Log (V3-2) + Résumé Analysis (V3-3) merged to `main` (local only). **131/131 tests** on merged main. Next planned: **V3-4 OpenRouter LLM layer** for résumé analysis. **Deployment deferred until after v3.** See root `../TRACKER.md` for the full module status._

## Notes / Blockers
- 2026-06-24 — **V3-3 follow-up fix (keyword noise) merged** (`11c8454`, `--no-ff`). The JD-match engine's salient-token fallback treated the top-15 frequent JD tokens as "hard skills", so generic filler (*frameworks/implement/practices/what/greenfield/…*) polluted matched/missing chips **and** suggestions. Fix: score **only** against the curated dictionary (dropped the fallback) and expanded `engine/skills.json` from ~26 → **115** real skills; suggestions now reference only genuine skills. Regression test asserts filler never appears. BE 131 tests. Tradeoff: dictionary-only is clean but bounded — a skill not in the list isn't detected (motivates the planned V3-4 OpenRouter LLM layer). **Restart the dev server after pulling** (no auto-reload).
- 2026-06-24 — **V3-3 Résumé Analysis / ATS (BE) done & merged** (`c2ba535`, `--no-ff`). New `analysis/` module: a **pure, offline scoring engine** (`engine/extract.js` PDF via pdf-parse v2 / DOCX via mammoth → `{text, ok}`; `engine/ats.js` ATS-friendliness audit → parseability/sections/contactInfo/formatting/length; `engine/match.js` JD-keyword + bundled `skills.json` match → matched/missing + weighted `matchScore`, null on empty JD; `engine/suggestions.js` rule suggestions) + an immutable, Zod-validated `ResumeAnalysis` snapshot (real migration; scores as columns + `report` Json). Endpoints `POST/GET /api/analysis`, `GET/DELETE /:id`, all `userId`-scoped; unparseable résumé → 201 parseability-failure (never 500); no-JD → `matchScore` null + full audit. TDD: 5 match + 4 ats + 3 suggestions + 4 extract + 5 API = 21 → **130 total**. Read-only review clean after fixes (`PDFParse.destroy()` to release the pdfjs worker; exclude multi-word-phrase component tokens from the salient-keyword pass). **Note:** the jest `test` script now sets `NODE_OPTIONS=--experimental-vm-modules` (pdfjs needs a dynamic-import worker); fixtures generated by `tests/fixtures/generate-resume-fixtures.js` (pdf-lib uncompressed + docx).
- 2026-06-24 — **V3-2 Activity Log (BE) done & merged** (`4e2994d`, `--no-ff`). New `activity/` module: an `ActivityLog` table (real migration `…_add_activity_log`; nullable `applicationId` `onDelete: SetNull`; JSON `metadata` snapshots) + a shared `record(userId, action, {applicationId, metadata})` helper called at curated write points across applications/interviews/documents/contacts (status & result events fire only on real transitions; `ApplicationDeleted` logs with `applicationId: null`). One filterable `GET /api/activity` (`applicationId` filter, opaque compound `<iso>|<id>` cursor via `limit`/`before` → `{items, nextCursor}`), `userId`-scoped, `userId` never returned. TDD: 11 activity tests → **108 total**. Read-only review clean; fix applied: compound `(createdAt, id)` cursor + tiebreaker ordering so events sharing a millisecond aren't dropped at a page boundary.
- 2026-06-24 — **V3-1 Documents (BE) done & merged** (`f0f55d8`, `--no-ff`). New `documents/` module: real file upload via **multer** (memory storage, 5 MB + PDF/DOC/DOCX allowlist → 400) behind a swappable `src/shared/storage/` interface (local disk in dev via `UPLOAD_DIR`; S3/Blob adapter deferred). Endpoints: `POST/GET /api/documents`, `GET /api/documents/:id/file` (stream + Content-Disposition), `PATCH`/`DELETE /api/documents/:id`, all `userId`-scoped; `storageKey`/`userId` never returned. `Document` + `ApplicationDocument` models via real migration `20260624010245_add_documents`; `POST/DELETE /api/applications/:id/documents` link/unlink (409 dup, idempotent 204) + `documents[]` on application detail. TDD: 3 storage + 10 documents + 5 application-link tests → **97 total**. Read-only review clean; applied fixes: download stream sets headers on `'open'` (no `ERR_HTTP_HEADERS_SENT` if the file is missing) + non-printable stripped from filename; orphaned blob removed if the DB insert fails after `storage.save`.
- 2026-06-23 — **V2-3 Reminders (BE) done & merged** (`515eebb`, `--no-ff`, branch deleted). New read-only `reminders/` module: composite `GET /api/reminders` → 4 `userId`-scoped buckets over a 7-day window (`interviews.{upcoming,overdue}`, `followUps.{due,upcoming}`) + `counts`, via `dashboard`/`analytics`-style `Promise.all`; no DB migration. Contacts Zod widened (`followUpDate: z.coerce.date().nullable().optional()`) so `PATCH /contacts/:id {followUpDate:null}` clears a follow-up. TDD: 5 new tests (1 contacts null-clear + 4 reminders: auth, empty, bucketing, cross-user isolation) → **79 total**. Read-only subagent review clean (no blockers).
- 2026-06-23 — BE-0…BE-5 implemented (TDD) and **merged to `main`** (`--no-ff`, feature branch deleted). 42/42 tests pass on merged main.
- Reviews: focused auth review (Approved) + whole-branch review ("merge after fixes"). Applied refresh-token family revocation on reuse, expired-token reaping on login, salary cross-field validation, logout userId scoping, deterministic interview ordering.
- 2026-06-22 — Local Postgres published on host port **5434** (5432 occupied by another project).
