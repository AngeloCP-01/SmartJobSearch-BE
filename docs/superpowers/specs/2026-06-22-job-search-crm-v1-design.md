# Smart Job Search CRM — v1 Design Spec

**Date:** 2026-06-22
**Status:** Approved
**Scope:** First vertical slice (v1) of a multi-version build.

## Purpose

A full-stack job-application tracker serving two goals at once:

1. **Portfolio piece** — demonstrate production-grade backend architecture, relational modeling, auth, and a polished React frontend.
2. **Personal tool** — something the author uses daily to track their own job search.

v1 is the smallest version that is genuinely usable day-to-day and deployable as a live demo. Later slices layer on the heavier infrastructure (queues, reminders, file storage, analytics) once the core is shipped and dogfooded.

## Build Strategy: Vertical Slices

The original `INITIAL_DOC.md` describes ~10 modules. Building all of them before shipping anything risks dying at ~70% with nothing deployable. Instead we ship usable, deployable versions incrementally:

- **v1 (this spec):** Auth, Companies, Applications + Kanban, Interviews, Dashboard counts.
- **v2 (future):** Contacts, Analytics dashboard, reminders.
- **v3 (future):** Resume versioning + file storage, Redis caching, BullMQ queues, Docker/deploy polish.

Each slice gets its own spec → plan → implementation cycle. The v1 module/folder layout reserves room for deferred modules so adding them needs no rework.

## Architecture Decisions

| Decision | Choice | Rationale |
|---|---|---|
| User model | Multi-user, public signup | Makes auth genuinely necessary; recruiters can register and try the live demo with their own data. |
| Hosting | Long-running Express server (Railway/Render) + managed Postgres | Matches the original doc; lets the author build real queue/cache/container infra in later slices. (Serverless was considered and rejected — it can't run BullMQ workers.) |
| Data layer | Prisma | Type-safe ORM, migrations, strong DX, common in Node job postings. |
| Auth tokens | Access + refresh (refresh in httpOnly cookie) | Correct, employable pattern; supports `/refresh` and `/logout`. |
| Validation | Zod | Schema validation at the route boundary. |
| Frontend build | Vite + React | Fast modern toolchain. |
| Kanban drag-drop | @dnd-kit | Maintained, accessible drag-and-drop. |
| Server state | TanStack Query | Caching, refetching, mutation handling. |
| Backend tests | Jest + Supertest (TDD) | Integration tests per module against a test DB. |
| Frontend tests | Vitest + React Testing Library | Light coverage on auth flow + Kanban for v1. |

## v1 Scope

**IN:** Auth (register/login/refresh/logout) · Companies (CRUD + search) · Applications (CRUD + Kanban board with drag-drop status) · Interviews (CRUD, linked to applications) · Dashboard summary counts.

**OUT (deferred):** Redis/BullMQ, email/reminders, resume file storage, Contacts, analytics charts, RBAC/Admin role, activity log.

## Data Model

All user-owned rows carry `user_id`; **every query filters on the authenticated user** (data isolation is a hard requirement, enforced in the service layer).

### User
- `id` (uuid, pk)
- `email` (unique, not null)
- `password_hash` (not null)
- `name`
- `created_at`

### RefreshToken
- `id` (uuid, pk)
- `user_id` (fk → User)
- `token_hash` (stored hashed, never raw)
- `expires_at`
- `created_at`

Enables refresh-token rotation and server-side logout (delete the row).

### Company
- `id` (uuid, pk)
- `user_id` (fk → User)
- `name` (not null)
- `industry`
- `website`
- `location`
- `size`
- `notes`
- `created_at`

### Application
- `id` (uuid, pk)
- `user_id` (fk → User)
- `company_id` (fk → Company)
- `position` (not null)
- `status` (enum `ApplicationStatus`, default `Draft`)
- `application_date`
- `salary_min`
- `salary_max`
- `source`
- `job_description`
- `notes`
- `created_at`
- `updated_at`

### Interview
- `id` (uuid, pk)
- `user_id` (fk → User)
- `application_id` (fk → Application)
- `type` (enum `InterviewType`)
- `scheduled_at`
- `interviewer`
- `notes`
- `result` (enum `InterviewResult`, nullable)
- `created_at`

### Enums
- **ApplicationStatus:** `Draft`, `Applied`, `HR_Screening`, `Technical_Interview`, `Final_Interview`, `Offer`, `Accepted`, `Rejected`, `Withdrawn`
- **InterviewType:** `HR`, `Technical`, `Managerial`, `Final`
- **InterviewResult:** `Pending`, `Passed`, `Failed`

## Backend Structure (Modular Monolith)

```
SmartJobSearchCRM-BE/
  prisma/
    schema.prisma
    migrations/
  src/
    modules/
      auth/        auth.controller.js  auth.service.js  auth.routes.js  auth.schema.js
      companies/   companies.controller.js  companies.service.js  companies.routes.js  companies.schema.js
      applications/ applications.controller.js  applications.service.js  applications.routes.js  applications.schema.js
      interviews/  interviews.controller.js  interviews.service.js  interviews.routes.js  interviews.schema.js
      dashboard/   dashboard.controller.js  dashboard.service.js  dashboard.routes.js
    shared/
      database/    prisma.js (singleton client)
      middleware/  auth.js  error.js  validate.js
      utils/
    routes/        index.js (mounts all module routers)
    app.js         (express app, middleware wiring)
    server.js      (http listen / bootstrap)
  docker-compose.yml  (Postgres for local dev; Redis reserved for later)
  .env.example
```

**Layering per module:** routes → validate (zod) → controller (http concerns) → service (business logic + Prisma) . Services never trust `req`; the authenticated `userId` is passed in explicitly.

## API Surface (v1)

### Auth
- `POST /auth/register` — { email, password, name } → creates user, returns access token + sets refresh cookie
- `POST /auth/login` — { email, password } → access token + refresh cookie
- `POST /auth/refresh` — reads refresh cookie → new access token (rotates refresh token)
- `POST /auth/logout` — invalidates refresh token, clears cookie
- `GET /auth/me` — current user profile

### Companies
- `GET /companies?search=` · `POST /companies` · `GET /companies/:id` · `PATCH /companies/:id` · `DELETE /companies/:id`

### Applications
- `GET /applications` (optionally `?status=`) · `POST /applications` · `GET /applications/:id` · `PATCH /applications/:id` · `DELETE /applications/:id`
- `PATCH /applications/:id/status` — dedicated endpoint for Kanban drag-drop moves

### Interviews
- `GET /interviews` (optionally `?applicationId=`) · `POST /interviews` · `GET /interviews/:id` · `PATCH /interviews/:id` · `DELETE /interviews/:id`

### Dashboard
- `GET /dashboard/summary` — total applications, count-by-status, upcoming interviews

## Frontend Structure

```
SmartJobSearchCRM-FE/
  src/
    pages/      Login  Register  Dashboard  Applications(Kanban)  Companies  Interviews
    components/ (shared UI: layout, forms, cards, board columns)
    api/        axios client (withCredentials) + per-resource query/mutation hooks
    routes/     router + auth guard
    lib/        helpers
  index.html  vite.config.js  tailwind.config.js
```

- **Auth:** access token held in memory; refresh cookie is httpOnly. On 401, an axios interceptor calls `/auth/refresh` once and retries; if that fails, redirect to login.
- **Route guard:** unauthenticated users are redirected to `/login`.
- **Applications page:** Kanban board with one column per status; dragging a card calls `PATCH /applications/:id/status` with optimistic update via TanStack Query.

## Error Handling

- Central Express error middleware produces a consistent JSON shape: `{ "error": { "message": string, "code": string } }`.
- Zod validation failures → `400` with per-field details.
- Auth failures → `401`; ownership/forbidden → `403`; missing resource → `404`.
- Services throw typed errors; the middleware maps them to status codes. No raw stack traces leak in production.

## Testing Strategy

- **Backend (TDD, Jest + Supertest):** each module gets integration tests covering happy path, validation errors, auth required, and **cross-user isolation** (user A cannot read/modify user B's rows). Tests run against a dedicated test database.
- **Frontend (Vitest + RTL):** cover the auth flow (login → guarded route) and the Kanban drag-to-update interaction. Kept intentionally light for v1.

## Local Dev & Deploy

- `docker-compose.yml` runs Postgres locally; `.env.example` documents required config (`DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, cookie settings, CORS origin).
- Prisma migrations manage schema.
- Deploy target: Railway or Render for the Express server, with a managed Postgres instance; frontend served as a static build (host TBD during deploy slice).

## Out of Scope for v1 (explicit)

Redis caching, BullMQ queues, email/SMTP, scheduled reminders, resume upload/versioning/file storage, Contacts module, analytics charts/reports, RBAC Admin role, activity-log/audit trail. These are planned for v2/v3 and the structure reserves room for them.
