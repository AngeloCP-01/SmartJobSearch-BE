# Log Drain via Sentry Logs (pino → Sentry) — Design

**Date:** 2026-07-16
**Status:** Approved (brainstorming) → pending implementation plan
**Scope:** Backend only (`SmartJobSearchCRM-BE`). Part of the production-observability track (the "log drain" item deferred from P2). Frontend Web Analytics and the P3 synthetic golden-path check remain separate rounds.

## Motivation

P2 shipped structured JSON logging (pino + pino-http) that currently writes only to Render's stdout. Render retains dashboard logs for a limited window and offers no query-by-field; its native Log Streams (syslog/HTTPS drains) **require a paid Scale/Organization workspace and are unavailable on our free plan**. So the JSON logs are drain-ready but stranded on the box.

This round ships the drain: forward the pino log stream off-box to a durable, queryable destination, so that when an error lands in Sentry we can pivot to the surrounding structured logs for that request.

## Decision: destination = Sentry Logs

Chosen over a dedicated log platform (e.g. Better Stack) to **consolidate into the existing `jobtrail-be` Sentry project** — one dashboard, one vendor, already wired. The decisive advantage: P2 already tags captured errors with `request_id`, and pino's `req.log` child logger already carries `req.id`, so logs and errors correlate on the same identifier inside one tool.

Trade-off accepted: Sentry's log-search UX is less specialized than a dedicated log platform, and the free-tier logs volume is limited (mitigated below by capturing `info` and above only).

## Decision: delivery = app-side, official `Sentry.pinoIntegration()`

Because Render's native drain is paywalled, logs must be shipped from within the app process. Options weighed:

| Approach | Verdict |
|---|---|
| **Official `Sentry.pinoIntegration()`** — auto-captures pino log calls as Sentry logs | **Chosen.** Least code, official, rides the existing single integration point. Requires SDK ≥ 10.18.0; project has `@sentry/node@^10.65.0`. |
| Custom pino transport target → `Sentry.logger.*` | Rejected — reinvents the integration, adds a worker-thread transport to maintain. |
| Manual `Sentry.logger.*` calls at log sites | Rejected — invasive, double-logging, defeats the "one integration point" convention. |

## Non-goals (deferred)

- **Frontend Vercel Web Analytics** (Core Web Vitals) — separate frontend round.
- **P3** scheduled synthetic golden-path check — separate, optional round.
- Any change to HTTP response bodies/status, or to what pino writes to stdout. Render stdout logging is unchanged; this round *adds* a second sink.
- New environment variables — reuses the existing `SENTRY_DSN`.

## Architecture

Single change surface: **`src/shared/observability/sentry.js`** (the existing "one integration point" for Sentry). Inside the current `Sentry.init({...})` — which only runs when `SENTRY_DSN` is set — add:

- `enableLogs: true`
- `integrations: [Sentry.pinoIntegration({ log: { levels: ['info', 'warn', 'error', 'fatal'] } })]`
- `beforeSendLog: scrubLog` — a redaction hook (see Security).

No change to `logger.js`'s pino configuration, `app.js`, or any log call site.

### Inertness (dev/test unchanged)

`initSentry()` is called **only** from `server.js`. The Jest suite loads `app.js`, never `server.js`, so `Sentry.init()` never runs under test and no pino hook is installed — the suite stays offline and silent exactly as today. In local dev without a DSN, `initSentry()` returns early before `Sentry.init()`. Log capture is therefore active only when a DSN is present (production), matching the existing error-capture behavior.

### Load-order dependency (load-bearing)

`Sentry.pinoIntegration()` instruments pino via `require-in-the-middle`, so `Sentry.init()` must run **before the first `require('pino')`**. `server.js` already satisfies this: `initSentry()` runs before `require('./app')`, which is the first module to pull in `logger.js` → `require('pino')`. This ordering was previously incidental to error capture; it is now also required for log capture. The implementation adds a comment in `server.js` marking the ordering as load-bearing, and the verification step confirms logs actually arrive (proving the hook installed).

## Level selection

Capture `info`, `warn`, `error`, `fatal`; exclude `trace`/`debug`. Rationale:
- The prod pino level is already `info` (`LOG_LEVEL || 'info'`), so `trace`/`debug` are not emitted anyway — the explicit `levels` filter is belt-and-suspenders and documents intent.
- Capturing `info` (not just `warn`+) keeps per-request completion logs in Sentry, which is the point: viewing the request stream around an error.
- High-frequency, low-signal endpoints (`/health`, `/health/deep`, `/version`) are already excluded from pino-http `autoLogging`, so they never become logs and never count against quota.
- **Free-tier dial:** if logs volume becomes a concern, narrow `levels` to `['warn','error','fatal']` — a one-line change. Documented as the escape hatch.

## Security — defense-in-depth redaction

The recurring theme of this track (P1 `beforeSend` scrub; P2 `redact` incl. the Set-Cookie fix). Layers, outermost first:

1. pino `redact` already removes `req.headers.authorization`, `req.headers.cookie`, `res.headers["set-cookie"]` before a log record exists.
2. The HTTP serializers already reduce req/res to `{id, method, url}` / `{statusCode}` — no headers reach request logs at all.
3. **New:** a `beforeSendLog(log)` hook re-scrubs the same sensitive attribute keys (`authorization`, `cookie`, `set-cookie`, case-insensitive) from the outgoing Sentry log's attributes, as a final net.

Reasoning for layer 3: it is not yet proven whether `pinoIntegration` reads records strictly *after* pino applies `redact`, or hooks the logger call earlier. Until proven, we do not rely on layers 1–2 alone for secrets. **This is the single most important thing to verify empirically during implementation** (below). Sentry `sendDefaultPii` remains unset (default `false`); no IP/user PII is attached.

## Testing

Follow the P1/P2 pattern (hermetic, no live network):

- `sentry.js` unit test: with a DSN set, `Sentry.init` is called with `enableLogs: true`, a `pinoIntegration` present, and `beforeSendLog` wired. With no DSN, `Sentry.init` is not called (stays inert).
- `beforeSendLog` unit test: given a log object whose attributes contain `authorization` / `cookie` / `set-cookie` (any casing), the returned log has them removed; benign attributes (incl. `request_id`) pass through untouched.
- No change to existing suites expected; `initSentry()` is still never invoked under test.

## Manual verification (production)

The empirical checks that unit tests can't cover:

1. Enable "Logs" in the `jobtrail-be` Sentry project settings.
2. Deploy; hit a normal logged endpoint → confirm an `info` request log appears in Sentry Logs carrying the `request_id` attribute.
3. Trigger a handled error → confirm the error (already `request_id`-tagged) and the request's logs share that id / are pivotable.
4. **Redaction proof:** temporarily emit a log line containing a fake `authorization`/`set-cookie` value, confirm it is absent from the Sentry log attributes (validates the `beforeSendLog` net), then revert.

## Deferred / minor follow-ups

- Sampling: no log sampling this round (traffic is low, free-tier quota adequate); revisit only if volume climbs.
- If the redaction-proof step shows the integration already reads post-`redact` records, `beforeSendLog` can be simplified to noise-dropping only — but keep it as defense-in-depth by default.

## Related

Production-observability track: P1 (Sentry + health, deployed), P1.5 (frontend Sentry, deployed), P2 (structured logging, deployed 2026-07-16). Next after this: FE Web Analytics, then optional P3.
