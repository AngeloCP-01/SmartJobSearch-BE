# JobTrail — API

Modular-monolith REST API for JobTrail, a multi-user job-search CRM: auth, companies, applications (Kanban status), interviews, contacts, documents, an activity log, a reminders feed, and an **AI-assisted résumé/ATS analysis** engine.

[![Backend CI](https://github.com/AngeloCP-01/SmartJobSearch-BE/actions/workflows/ci.yml/badge.svg)](https://github.com/AngeloCP-01/SmartJobSearch-BE/actions/workflows/ci.yml)
&nbsp;**[▶ Live demo](https://jobtrail-hq.vercel.app)** · **[Frontend repo](https://github.com/AngeloCP-01/SmartJobSearch-FE)** · **[Deploy guide](./DEPLOY.md)**

## Stack

Node.js · Express · PostgreSQL (Prisma) · JWT (access + httpOnly refresh cookie) · Zod · OpenRouter (AI) · Jest + Supertest. Deployed on Render + Neon + Supabase Storage.

## Architecture

A **modular monolith** — one module per domain, each with its own `routes → controller → service → schema` and integration tests, sharing a thin infra layer.

```
src/
  modules/
    auth/ companies/ applications/ interviews/ contacts/
    documents/ activity/ analysis/ postings/ reminders/ dashboard/
  shared/
    database/   (Prisma client singleton)
    storage/    (save/createReadStream/remove — local-disk or S3 driver)
    middleware/ utils/
  routes/index.js   app.js   server.js
prisma/schema.prisma   prisma/seed.js
tests/
```

### Engineering highlights

- **Resilient auth** — short-lived access JWT + rotating refresh token in an httpOnly cookie; cross-site `SameSite=None; Secure` in production.
- **AI with a safety net** — the analysis engine tries a chain of LLM models, **fast-fails on 429 rate limits** to the next model, and falls back to a deterministic keyword matcher so the feature never hard-fails. Reports are validated with Zod.
- **Swappable storage** — a `save/createReadStream/remove` interface backs both local disk (dev) and S3-compatible object storage (prod, e.g. Supabase/R2) so uploads survive an ephemeral-disk host. Chosen by one env var; no caller changes.
- **Per-user isolation** — every query is scoped to the authenticated user; tests assert one user can’t read/modify another’s data.

## Prerequisites

- Node.js 20+
- Docker (for local Postgres)

## Setup

```bash
docker compose up -d                                                   # Postgres on host port 5434
docker compose exec db psql -U crm -d jobcrm -c "CREATE DATABASE jobcrm_test;"   # one-time, for tests
cp .env.example .env
npm install
npm run migrate                                                        # apply migrations + generate client
npm run dev                                                            # http://localhost:4000
npm run seed                                                           # optional: load the demo dataset
```

> **Port note:** local Postgres is published on **5434** to avoid clashing with other Postgres on 5432. `.env` / `.env.test` already point there.

## Tests

```bash
npm test    # Jest + Supertest against jobcrm_test; global setup applies migrations
```

Every module covers happy paths, validation errors, auth requirements, and cross-user isolation. CI runs the suite against a Postgres service container on every push/PR.

## API

All routes are under `/api`; authenticated requests send `Authorization: Bearer <accessToken>` and the refresh token rides in an httpOnly cookie scoped to `/api/auth`.

| Area | Endpoints |
|------|-----------|
| Health | `GET /health` |
| Auth | `POST /auth/register` · `/login` · `/refresh` · `/logout` · `GET /auth/me` |
| Companies | `GET /companies?search=` · `POST` · `GET/PATCH/DELETE /companies/:id` |
| Applications | `GET /applications?status=` · `POST` · `GET/PATCH/DELETE /:id` · `PATCH /:id/status` |
| Interviews | `GET /interviews?applicationId=` · `POST` · `GET/PATCH/DELETE /:id` |
| Contacts | `GET /contacts` · `POST` · `GET/PATCH/DELETE /:id` · link/unlink to applications |
| Documents | `GET /documents` · `POST` (multipart; PDF/DOC/DOCX/TXT) · `GET /:id/file` · `PATCH/DELETE /:id` · link/unlink |
| Analysis | `POST /analysis` · `GET /analysis` · `GET /:id` · `DELETE /:id` · `GET /analysis/config` · `POST /analysis/cover-letter` (AI) |
| Postings | `POST /postings/parse` — AI-extract application fields from pasted text/URL |
| Activity | `GET /activity?applicationId=&cursor=` |
| Reminders | `GET /reminders` |
| Dashboard / Analytics | `GET /dashboard/summary` · `GET /analytics` |

## Deployment

Full free-tier walkthrough (Neon + Supabase + Render + Vercel), with the cross-origin cookie/CORS gotchas, in **[`DEPLOY.md`](./DEPLOY.md)**.
