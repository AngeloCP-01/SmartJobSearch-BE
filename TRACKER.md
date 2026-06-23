# Backend Tracker (v1)

Status legend: ☐ Not started · ◐ In progress · ☑ Done · ⛔ Blocked

**Last updated:** 2026-06-22
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

## Tests
40 passing across 8 suites (health, middleware, authUtils, auth, companies, applications, interviews, dashboard).

## In Flight
_BE-6 (deploy) remains; everything else complete on branch `feat/backend-v1`._

## Notes / Blockers
- 2026-06-22 — BE-0…BE-5 implemented (TDD), committed on `feat/backend-v1`. Auth module passed a focused review (clearCookie attrs + cookie-attribute test assertions applied).
- Local Postgres published on host port **5434** (5432 occupied by another project).
