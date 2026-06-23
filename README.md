# Smart Job Search CRM — Backend (v1)

Modular-monolith REST API for a multi-user job-application tracker: auth, companies, applications (with a Kanban status endpoint), interviews, and a dashboard summary.

## Stack

Node.js · Express · PostgreSQL (Prisma) · JWT (access + refresh cookie) · Zod · Jest + Supertest.

## Prerequisites

- Node.js 20+
- Docker (for local Postgres)

## Setup

```bash
# 1. Start Postgres (host port 5434 → container 5432)
docker compose up -d

# 2. Create the test database (one-time)
docker compose exec db psql -U crm -d jobcrm -c "CREATE DATABASE jobcrm_test;"

# 3. Configure env
cp .env.example .env

# 4. Install dependencies
npm install

# 5. Apply migrations + generate the Prisma client
npm run migrate

# 6. Run the API (http://localhost:4000)
npm run dev
```

> **Port note:** local Postgres is published on host port **5434** to avoid clashing with other local Postgres instances on 5432. `DATABASE_URL` in `.env` / `.env.test` already points at 5434.

## Tests

```bash
npm test
```

Integration tests (Jest + Supertest) run against the `jobcrm_test` database; the global setup applies migrations automatically. Every module covers happy paths, validation errors, auth requirements, and cross-user isolation.

## API

All routes are mounted under `/api`.

| Area | Endpoints |
|------|-----------|
| Health | `GET /api/health` |
| Auth | `POST /api/auth/register` · `/login` · `/refresh` · `/logout` · `GET /api/auth/me` |
| Companies | `GET /api/companies?search=` · `POST` · `GET/PATCH/DELETE /api/companies/:id` |
| Applications | `GET /api/applications?status=` · `POST` · `GET/PATCH/DELETE /:id` · `PATCH /:id/status` |
| Interviews | `GET /api/interviews?applicationId=` · `POST` · `GET/PATCH/DELETE /:id` |
| Dashboard | `GET /api/dashboard/summary` |

Authenticated requests send `Authorization: Bearer <accessToken>`; the refresh token is an httpOnly cookie scoped to `/api/auth`.

## Project structure

```
src/
  modules/{auth,companies,applications,interviews,dashboard}/   # routes → controller → service → schema
  shared/{database, middleware, utils}/
  routes/index.js   app.js   server.js
prisma/schema.prisma
tests/
```

## Status

v1 backend (BE-0…BE-5) complete. Deployment (BE-6) is handled separately. See `docs/superpowers/specs/` and `docs/superpowers/plans/` for the design spec and implementation plan.
