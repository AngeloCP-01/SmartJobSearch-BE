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

## Tests
69 passing across 9 suites (adds the `contacts` suite + auth rotation-race / remember-me + long-source tests).

## In Flight
_v2 Contacts + post-Contacts fixes merged to `main` (local only). **Deployment paused.** Next v2 slice: **Analytics** (then Reminders) — start in a new session via root `../V2-ANALYTICS-KICKOFF.md`. See root `../TRACKER.md` for the full v2 module status._

## Notes / Blockers
- 2026-06-23 — BE-0…BE-5 implemented (TDD) and **merged to `main`** (`--no-ff`, feature branch deleted). 42/42 tests pass on merged main.
- Reviews: focused auth review (Approved) + whole-branch review ("merge after fixes"). Applied refresh-token family revocation on reuse, expired-token reaping on login, salary cross-field validation, logout userId scoping, deterministic interview ordering.
- 2026-06-22 — Local Postgres published on host port **5434** (5432 occupied by another project).
