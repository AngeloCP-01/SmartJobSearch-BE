# Backend Tasks (v1)

Spec: `docs/superpowers/specs/2026-06-22-job-search-crm-v1-design.md`
Plan: `docs/superpowers/plans/2026-06-22-backend-v1.md`
Master coordination: `../TASKS.md`

> **Status (2026-06-23):** BE-0…BE-5 ✅ done — implemented TDD, reviewed, and merged to `main` (42 tests passing). Only **BE-6 (deploy)** remains.

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
