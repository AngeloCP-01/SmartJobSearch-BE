# Log Drain via Sentry Logs (pino → Sentry) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Forward the backend's pino log stream into the existing `jobtrail-be` Sentry project via the official `Sentry.pinoIntegration()`, with a defense-in-depth redaction net.

**Architecture:** Single change surface — `src/shared/observability/sentry.js`. Inside the existing `Sentry.init({...})` (only runs when `SENTRY_DSN` is set) we enable Sentry Logs, add the pino integration filtered to `info`+ levels, and add a `beforeSendLog` hook that strips sensitive attribute keys. `logger.js`, `app.js`, and all log call sites are untouched. A load-bearing comment is added in `server.js`.

**Tech Stack:** Node.js, `@sentry/node@^10.65.0` (has `pinoIntegration`, needs ≥10.18.0), `pino@^10.3.1`, Jest.

## Global Constraints

- **Change surface:** only `src/shared/observability/sentry.js` (+ its test) and a comment in `src/server.js`. Do NOT modify `logger.js`, `app.js`, or any log call site.
- **Inert unless configured:** all new behavior lives inside `Sentry.init({...})`, which is reached only when `SENTRY_DSN` is set. `initSentry()` is called only from `server.js`; the Jest suite loads `app.js`, so init never runs under test.
- **No new env vars:** reuse `SENTRY_DSN`.
- **SDK floor:** `Sentry.pinoIntegration()` requires `@sentry/node` ≥ 10.18.0. Project has `^10.65.0` — do not downgrade.
- **Load order (load-bearing):** `initSentry()` must run before the first `require('pino')`. `server.js` already does (`initSentry()` before `require('./app')`). Preserve it.
- **Captured levels:** `['info','warn','error','fatal']` (exclude `trace`/`debug`).
- **Test style:** mirror `sentry.test.js` — `jest.mock('@sentry/node', ...)`, `jest.isolateModules` via `loadFresh()`, env save/restore in `beforeEach`/`afterEach`.
- **Commit trailer:** end each commit message with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

### Task 1: `scrubLog` redaction helper

Pure function that strips sensitive keys from a Sentry log's `attributes`, case-insensitively. This is the defense-in-depth net (layer 3 in the spec).

**Files:**
- Modify: `src/shared/observability/sentry.js`
- Test: `src/shared/observability/sentry.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `scrubLog(log)` — takes a log object `{ level, message, attributes?, ... }`, mutates+returns it with any attribute whose key (lower-cased) is one of `authorization`, `cookie`, `set-cookie` removed. Returns the log unchanged when `attributes` is missing/not an object. Exported from `sentry.js` for testing (alongside `scrub`).

- [ ] **Step 1: Write the failing test**

Add to `src/shared/observability/sentry.test.js`:

```js
test('scrubLog removes sensitive attribute keys case-insensitively', () => {
  const { scrubLog } = loadFresh();
  const out = scrubLog({
    level: 'info',
    message: 'req done',
    attributes: {
      Authorization: 'Bearer x',
      cookie: 'session=1',
      'Set-Cookie': 'refresh=2',
      request_id: 'abc-123',
      url: '/api/foo',
    },
  });
  expect(out.attributes.Authorization).toBeUndefined();
  expect(out.attributes.cookie).toBeUndefined();
  expect(out.attributes['Set-Cookie']).toBeUndefined();
  expect(out.attributes.request_id).toBe('abc-123');
  expect(out.attributes.url).toBe('/api/foo');
});

test('scrubLog tolerates a log with no attributes', () => {
  const { scrubLog } = loadFresh();
  const log = { level: 'info', message: 'no attrs' };
  expect(scrubLog(log)).toBe(log);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/shared/observability/sentry.test.js -t scrubLog`
Expected: FAIL — `scrubLog is not a function` (undefined export).

- [ ] **Step 3: Write minimal implementation**

In `src/shared/observability/sentry.js`, add near the top (after the `Sentry` require, before `initSentry`):

```js
// Defense-in-depth: strip credential-bearing attribute keys from any log
// before it leaves for Sentry Logs. pino's `redact` and the compact HTTP
// serializers already keep these out of records; this is the final net in
// case the pino integration reads a log call before pino applies redaction.
// Mirrors the `scrub` event hook and the P2 Set-Cookie redaction.
const SENSITIVE_LOG_KEYS = new Set(['authorization', 'cookie', 'set-cookie']);
function scrubLog(log) {
  const attrs = log && log.attributes;
  if (attrs && typeof attrs === 'object') {
    for (const key of Object.keys(attrs)) {
      if (SENSITIVE_LOG_KEYS.has(key.toLowerCase())) delete attrs[key];
    }
  }
  return log;
}
```

Add `scrubLog` to `module.exports`:

```js
module.exports = { initSentry, captureError, scrub, scrubLog };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/shared/observability/sentry.test.js -t scrubLog`
Expected: PASS (both scrubLog tests).

- [ ] **Step 5: Commit**

```bash
git add src/shared/observability/sentry.js src/shared/observability/sentry.test.js
git commit -m "$(printf 'feat: add scrubLog redaction helper for Sentry Logs\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 2: Enable Sentry Logs + wire pino integration and beforeSendLog

Turn on Sentry Logs and route pino through it, filtered to `info`+ levels, with `scrubLog` as the outgoing hook. Add the load-bearing ordering comment in `server.js`.

**Files:**
- Modify: `src/shared/observability/sentry.js` (the `Sentry.init({...})` call)
- Modify: `src/server.js` (comment only)
- Test: `src/shared/observability/sentry.test.js`

**Interfaces:**
- Consumes: `scrubLog` from Task 1; `@sentry/node`'s `pinoIntegration`.
- Produces: `initSentry()` now calls `Sentry.init` with `enableLogs: true`, `integrations: [Sentry.pinoIntegration({ log: { levels: ['info','warn','error','fatal'] } })]`, and `beforeSendLog: scrubLog`. No signature change; still no-op without a DSN.

- [ ] **Step 1: Extend the mock and write the failing test**

In `src/shared/observability/sentry.test.js`, update the mock at the top of the file so `Sentry.pinoIntegration` exists (add a mock fn and return a sentinel):

```js
const mockInit = jest.fn();
const mockCapture = jest.fn();
const mockPinoIntegration = jest.fn(() => ({ name: 'Pino' }));
jest.mock('@sentry/node', () => ({
  init: mockInit,
  captureException: mockCapture,
  pinoIntegration: mockPinoIntegration,
}));
```

Add `mockPinoIntegration.mockClear();` inside the existing `afterEach` alongside the other `mockReset()` calls.

Then add this test:

```js
test('initSentry enables logs with the pino integration and scrubLog hook', () => {
  process.env.SENTRY_DSN = 'https://k@o.ingest.sentry.io/1';
  process.env.NODE_ENV = 'production';
  const { initSentry, scrubLog } = loadFresh();
  initSentry();
  const opts = mockInit.mock.calls[0][0];
  expect(opts.enableLogs).toBe(true);
  expect(opts.beforeSendLog).toBe(scrubLog);
  expect(mockPinoIntegration).toHaveBeenCalledWith({
    log: { levels: ['info', 'warn', 'error', 'fatal'] },
  });
  expect(opts.integrations).toContainEqual({ name: 'Pino' });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/shared/observability/sentry.test.js -t "enables logs"`
Expected: FAIL — `opts.enableLogs` is `undefined` (not yet wired).

- [ ] **Step 3: Write minimal implementation**

In `src/shared/observability/sentry.js`, extend the `Sentry.init({...})` call inside `initSentry()` to include the three new options:

```js
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || 'development',
    release: process.env.RENDER_GIT_COMMIT || process.env.COMMIT_SHA || undefined,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || 0),
    beforeSend: scrub,
    // Sentry Logs: forward the pino stream into this project so logs correlate
    // with the request_id-tagged errors captured in error.js. info+ only, to
    // stay within the free-tier logs quota (dial to warn+ if volume climbs).
    enableLogs: true,
    integrations: [
      Sentry.pinoIntegration({ log: { levels: ['info', 'warn', 'error', 'fatal'] } }),
    ],
    beforeSendLog: scrubLog,
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/shared/observability/sentry.test.js -t "enables logs"`
Expected: PASS.

- [ ] **Step 5: Add the load-bearing ordering comment in `server.js`**

In `src/server.js`, replace the top three lines:

```js
require('dotenv').config();
const { initSentry } = require('./shared/observability/sentry');
initSentry();
```

with:

```js
require('dotenv').config();
// LOAD-BEARING ORDER: initSentry() must run before the first require('pino')
// (pulled in below via ./app -> logger.js) so Sentry.pinoIntegration()'s
// require-in-the-middle hook is installed in time to capture pino logs.
const { initSentry } = require('./shared/observability/sentry');
initSentry();
```

- [ ] **Step 6: Run the full observability suite**

Run: `npx jest src/shared/observability`
Expected: PASS — both `sentry.test.js` and `logger.test.js` green (logger unaffected).

- [ ] **Step 7: Commit**

```bash
git add src/shared/observability/sentry.js src/shared/observability/sentry.test.js src/server.js
git commit -m "$(printf 'feat: forward pino logs to Sentry Logs via pinoIntegration\n\nEnable Sentry Logs (info+), wire the official pino integration, and scrub\nsensitive attributes via beforeSendLog. Mark the initSentry-before-pino\nload order as load-bearing.\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 3: Full-suite regression check

Confirm nothing else broke (the P2 suite had known parallel-DB flakiness unrelated to this change — see the observability memory).

**Files:** none (verification only).

- [ ] **Step 1: Run the full suite**

Run: `npm test`
Expected: The observability suites pass. If unrelated `applications/contacts/analysis` DB-schema flakiness appears, re-run those in isolation: `npx jest --runInBand <path>` — pre-existing, not caused by this change. Do NOT "fix" it here.

- [ ] **Step 2: No commit** (verification task).

---

## Manual verification (post-deploy, cannot be unit-tested)

From the spec's "Manual verification" section — perform after merge + deploy:

1. Enable **Logs** in the `jobtrail-be` Sentry project settings.
2. Deploy backend (main). Hit a normal logged endpoint → confirm an `info` request log appears in Sentry Logs carrying the `request_id` attribute.
3. Trigger a handled error → confirm it (already `request_id`-tagged) and the request's logs share that id / are pivotable in one view.
4. **Redaction proof:** temporarily emit a log line containing a fake `authorization`/`set-cookie` value, confirm it is absent from the Sentry log attributes (validates `beforeSendLog`), then revert.

## Self-Review notes

- **Spec coverage:** destination=Sentry (Task 2), delivery=pinoIntegration (Task 2), info+ levels (Task 2), beforeSendLog redaction (Tasks 1+2), load-order guard (Task 2 Step 5), inertness (unchanged — verified by the existing "no-op when DSN unset" test still passing in Task 3), manual verification (documented, non-automatable). No gaps.
- **No new env vars, single change surface** — honored.
- **Type consistency:** `scrubLog` defined in Task 1 is referenced identically (`beforeSendLog: scrubLog`, `expect(opts.beforeSendLog).toBe(scrubLog)`) in Task 2.
