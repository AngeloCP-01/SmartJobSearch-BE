# Backend Tasks (v1)

Spec: `docs/superpowers/specs/2026-06-22-job-search-crm-v1-design.md`
Plan: `docs/superpowers/plans/2026-06-22-backend-v1.md`
Master coordination: `../TASKS.md`

> **Status (2026-06-23):** BE-0…BE-5 ✅ + **v1.5 application-details** ✅ — implemented TDD, reviewed, and merged to `main` (45 tests passing). Only **BE-6 (deploy)** remains.
>
> **v1.5 (application details):** application responses include `company {id,name}`; `PATCH` with `companyId: null` unlinks. Spec: `docs/superpowers/specs/2026-06-23-application-details-design.md`.

> **Update (2026-06-26):** **BE-6 deploy done** — API live on Render + Neon + Supabase (`DEPLOY.md`). Plus a portfolio-readiness pass: **demo seed** (`prisma/seed.js`, seeded to prod), **keep-alive** + **CI** GitHub Actions, and a rewritten portfolio README. Then AI features: **cover-letter generator** + **job-posting auto-import** (`postings` module). Fixed the serial-suite test-DB flake (`connection_limit=1`). Tests **170 passing / 1 skipped — reliably green in CI**. See `TRACKER.md` Notes.
>
> **Update (2026-06-29):** **V3-5 — In-app document editor (BE)** done, reviewed, **PR #1 merged to `main` (CI-green)**. New `authored-documents` CRUD module + `AuthoredDocument` model/migration for rich-text docs authored in-app (separate from the V3-1 uploads module). `userId`-scoped, ownership enforced on read+write, list omits `content`, optional application link. **188 tests** (full suite green). Spec/plan: `docs/superpowers/{specs,plans}/2026-06-29-authored-document-editor*.md`. See `TRACKER.md` Notes.
>
> **Update (2026-06-30):** **V3-6 — Editor v2 (Typography & Page Layout)** is **frontend-only**; this repo carries only the spec + plan (`docs/superpowers/…2026-06-29-editor-v2-typography-page-layout…`), merged to `main`. No backend code/migration. Implementation + 170 tests in `SmartJobSearchCRM-FE`.
>
> **Update (2026-06-30):** **V3-7 — Editor v3 (Tables & Find/Replace)** is **frontend-only**; this repo carries only the spec + plan (`docs/superpowers/…2026-06-30-editor-v3-tables-findreplace…`), merged to `main`. No backend code/migration. Implementation + 184 tests in `SmartJobSearchCRM-FE`. **Heads-up:** the next editor batch (V4 — images) WILL need this repo — a public-URL/storage capability for `<img src>` (new `getPublicUrl` + public bucket/image endpoint). See `TRACKER.md` Notes.

> Granular per-step tasks lived in the implementation plan above; this file is the milestone summary.

## BE-0 — Scaffold
- Express app + server bootstrap (`app.js` / `server.js`)
- Prisma init + `schema.prisma` with User, RefreshToken, Company, Application, Interview + enums
- `docker-compose.yml` (Postgres), `.env.example`
- Shared middleware: error handler, zod `validate`, request logging
- Jest + Supertest harness against a test database

## BE-1 — Auth
- Models wired: User, RefreshToken
- `POST /auth/register`, `/login`, `/refresh`, `/logout`; `GET /auth/me`
- Password hashing (bcrypt/argon2), JWT access token, refresh token in httpOnly cookie + rotation
- `auth` middleware (extracts/validates access token → `userId`)

## BE-2 — Companies
- CRUD `/companies` + `?search=`
- Per-user isolation enforced in service layer

## BE-3 — Applications
- CRUD `/applications` (+ `?status=`)
- `PATCH /applications/:id/status` for Kanban moves
- FK to Company; status enum validation

## BE-4 — Interviews
- CRUD `/interviews` (+ `?applicationId=`)
- FK to Application; type/result enums

## BE-5 — Dashboard
- `GET /dashboard/summary`: total applications, count-by-status, upcoming interviews

## BE-6 — Deploy
- Railway/Render service + managed Postgres
- Production env/secrets, CORS origin, run migrations
