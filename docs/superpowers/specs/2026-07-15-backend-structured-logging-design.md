# Backend Structured Logging (pino) — Design

**Date:** 2026-07-15
**Status:** Approved (brainstorming) → pending implementation plan
**Scope:** Backend only (`SmartJobSearchCRM-BE`). Part of the production-observability track (P2). Log drain and frontend Web Analytics are explicitly deferred to later rounds.

## Motivation

The backend has no logging library and no request correlation. Diagnostics today are 13 scattered `console.*` calls (unstructured, always-on, no levels, no requestId). After the P1 work (Sentry + health checks), the next gap is **operational visibility**: when an error lands in Sentry, there is no structured request log to pivot to, no per-request latency/status signal, and nothing a future log drain could parse.

P2 adds structured JSON logging with per-request correlation, mirroring the existing Sentry module's conventions.

## Non-goals (deferred)

- **Log drain** (Better Stack / Sentry Logs) — later round; JSON to stdout is drain-ready.
- **Frontend Vercel Web Analytics** — separate frontend round.
- Changing any HTTP response body or status. This is observability-only.

## Architecture

New single integration point: **`src/shared/observability/logger.js`** (same folder and "one integration point" convention as `sentry.js`).

Exports:
- `logger` — root pino instance.
- `httpLogger` — configured `pino-http` middleware.

### Configuration

| Concern | Behavior |
|---|---|
| **Level** | From `LOG_LEVEL` env; default `info`. `NODE_ENV=test` → `silent` (Jest output stays clean, exactly as Sentry is inert in tests). |
| **Format** | `pino-pretty` transport when `NODE_ENV !== 'production'` (devDependency); raw single-line JSON in prod for Render/future drains. |
| **Redaction** | pino `redact` on `req.headers.authorization` and `req.headers.cookie`. We now log requests, so this prevents the access token / session cookie from ever reaching logs — mirrors the Sentry `beforeSend` scrub (defense-in-depth). |

### Dependencies

- Prod: `pino`, `pino-http`
- Dev: `pino-pretty`

## Request logging & requestId

- `httpLogger` mounted early in `app.js` — after `app.set('trust proxy', 1)`, before the routers.
- **requestId** (`pino-http` `genReqId`): honor an inbound `X-Request-Id` header if present (proxy / trace propagation), else `crypto.randomUUID()`.
- The requestId is:
  - echoed back in the `X-Request-Id` response header,
  - attached to every auto-generated request log line,
  - available in handlers via the `req.log` child logger.
- **Noise control:** `autoLogging.ignore` skips `/health`, `/health/deep`, `/version` — the same endpoints already excluded from rate limiting. (Both the `/api` and `/api/v1` mounts are covered since matching is on the request path suffix.)

## Error path & Sentry correlation

- `src/shared/middleware/error.js`: replace `console.error(err)` with `req.log.error({ err }, 'unhandled error')`, falling back to the root `logger` if `req.log` is unavailable. pino's standard `err` serializer produces structured stack traces.
- Set the requestId on the Sentry scope as a `request_id` tag so a captured exception and its request log share one id (pivot Sentry ↔ logs). Applied where the requestId is known (request scope); must remain a no-op when Sentry is unconfigured.
- **Unchanged:** the existing 500-gating rule (only non-`AppError`, or `AppError.status >= 500`, is captured). Logging does not alter what Sentry receives or what the client sees.

## Migrating existing `console.*`

Replace the current calls with `logger` / `req.log` (same messages, now structured + level-controlled — no behavior change):

| Location | From | To |
|---|---|---|
| `server.js` startup | `console.log('API listening…')` | `logger.info(...)` |
| `error.js` | `console.error(err)` | `req.log.error({ err }, …)` |
| `storage/index.js` read fail | `console.error(...)` | `logger.error({ err, key }, …)` |
| `postings.service.js` | `console.warn(...)` | `logger.warn({ err, kind }, …)` |
| `analysis.service.js` ×4 | `console.warn(...)` | `logger.warn({ err, kind }, …)` |
| `documents.service.js` rag warn | `console.warn(...)` | `logger.warn({ err }, …)` |
| `images.controller.js` / `authored-documents.controller.js` editor-debug (DBG-gated) | `console.log(...)` | `logger.debug(...)` |

The DBG-gated editor-debug logs become `logger.debug` (visible only when `LOG_LEVEL=debug`), so the existing `DBG` env flag can be retired or left as-is; retiring is preferred to avoid two toggles.

## Testing

- New `src/shared/observability/logger.test.js`:
  - level resolves to `silent` under `NODE_ENV=test`;
  - `genReqId` generates an id when no header present, and honors an inbound `X-Request-Id`;
  - redaction removes `authorization` and `cookie` from a logged request object.
- Integration assertion (in an existing supertest-style suite or a small new one): a request sets the `X-Request-Id` response header.
- The full existing Jest suite must stay green. Logger `silent` under test means **no new stdout pollution** — the same bar the editor-debug logging work held (obs 795).
- Note: the suite has known pre-existing parallel-DB-schema flakiness (P1 finding); this change touches none of that.

## Rollout

- No new required env to run: `LOG_LEVEL` is optional (defaults sane per environment).
- Deploy is a normal backend deploy. In prod, logs become structured JSON on Render's stdout immediately — a later drain can consume them without further app changes.

## Open follow-ups (out of scope here)

- Log drain wiring (Better Stack free tier vs Sentry Logs).
- Frontend Web Analytics (Core Web Vitals).
- Optional: request log sampling if volume becomes a concern once a drain with quota is attached.
