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

## v1.5 — Application Details (backend slice) ☑ (2026-06-23)
Application responses now include `company { id, name }`; `PATCH /applications/:id` with `companyId: null` unlinks. Branch `feat/application-details`. (Frontend drawer lives in the FE repo.)

## Tests
45 passing across 8 suites (adds 3 application-details tests).

## In Flight
_BE-0…BE-5 merged to `main`. Only BE-6 (deploy) remains. `main` is local-only (not pushed to origin)._

## Notes / Blockers
- 2026-06-23 — BE-0…BE-5 implemented (TDD) and **merged to `main`** (`--no-ff`, feature branch deleted). 42/42 tests pass on merged main.
- Reviews: focused auth review (Approved) + whole-branch review ("merge after fixes"). Applied refresh-token family revocation on reuse, expired-token reaping on login, salary cross-field validation, logout userId scoping, deterministic interview ordering.
- 2026-06-22 — Local Postgres published on host port **5434** (5432 occupied by another project).
