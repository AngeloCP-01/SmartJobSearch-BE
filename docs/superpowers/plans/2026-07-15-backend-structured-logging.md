# Backend Structured Logging (pino) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-request structured JSON logging with a correlation requestId to the Express backend, replacing all scattered `console.*` calls.

**Architecture:** A single `src/shared/observability/logger.js` module (mirrors `sentry.js`) exports a root `logger` (pino) and `httpLogger` (pino-http) middleware. `httpLogger` is mounted early in `app.js`, generating/honoring a requestId per request and exposing a `req.log` child logger. The error middleware logs structured errors and passes the requestId to Sentry as a tag. All existing `console.*` calls migrate to the logger.

**Tech Stack:** Node 22, Express 4.19, pino, pino-http, pino-pretty (dev), Jest 29 (`NODE_OPTIONS=--experimental-vm-modules`), supertest.

## Global Constraints

- **Backend only** (`SmartJobSearchCRM-BE`). No frontend changes. No log-drain wiring.
- **Silent under test:** when `NODE_ENV=test`, logger level is `silent` — the Jest suite must gain **no** new stdout output (bar held by the editor-debug logging work).
- **No response contract changes:** HTTP status codes and JSON bodies are unchanged. Observability only.
- **Redaction:** `req.headers.authorization` and `req.headers.cookie` must never appear in logs.
- **Sentry gating unchanged:** only non-`AppError`, or `AppError.status >= 500`, is captured. Logging must not alter this.
- **Pretty in dev, JSON in prod:** `pino-pretty` transport only when `NODE_ENV` is neither `production` nor `test`.
- Follow existing module conventions: CommonJS `require`, `module.exports = { ... }`, comment style matching `sentry.js`.

---

### Task 1: Logger module (core) + tests

**Files:**
- Modify: `package.json` (add deps)
- Create: `src/shared/observability/logger.js`
- Test: `src/shared/observability/logger.test.js`

**Interfaces:**
- Consumes: nothing (leaf module).
- Produces:
  - `logger` — a pino `Logger` instance.
  - `httpLogger` — a `pino-http` request-handler middleware `(req, res, next) => void`.
  - `genReqId(req, res) => string` — returns the inbound `x-request-id` header if present, else a `crypto.randomUUID()`; sets the `X-Request-Id` response header as a side effect.
  - `REDACT` — the pino redact option object `{ paths: string[], remove: true }` used by `logger`.

- [ ] **Step 1: Install dependencies**

Run:
```bash
cd /Users/angelito/personal/SmartJobSearchCRM/SmartJobSearchCRM-BE
npm install pino pino-http
npm install --save-dev pino-pretty
```
Expected: `pino`, `pino-http` under `dependencies`; `pino-pretty` under `devDependencies` in `package.json`.

- [ ] **Step 2: Write the failing test**

Create `src/shared/observability/logger.test.js`:
```javascript
const { PassThrough } = require('stream');
const pino = require('pino');

// The module reads NODE_ENV at require time; Jest sets NODE_ENV=test.
const loadFresh = () => {
  let mod;
  jest.isolateModules(() => { mod = require('./logger'); });
  return mod;
};

test('logger level is silent under NODE_ENV=test', () => {
  const { logger } = loadFresh();
  expect(logger.level).toBe('silent');
});

test('genReqId generates a uuid and sets the X-Request-Id response header', () => {
  const { genReqId } = loadFresh();
  const setHeader = jest.fn();
  const id = genReqId({ headers: {} }, { setHeader });
  expect(id).toMatch(/^[0-9a-f-]{36}$/);
  expect(setHeader).toHaveBeenCalledWith('X-Request-Id', id);
});

test('genReqId honors an inbound x-request-id header', () => {
  const { genReqId } = loadFresh();
  const setHeader = jest.fn();
  const id = genReqId({ headers: { 'x-request-id': 'trace-abc' } }, { setHeader });
  expect(id).toBe('trace-abc');
  expect(setHeader).toHaveBeenCalledWith('X-Request-Id', 'trace-abc');
});

test('REDACT removes authorization and cookie from logged requests', (done) => {
  const { REDACT } = loadFresh();
  const sink = new PassThrough();
  let out = '';
  sink.on('data', (c) => { out += c.toString(); });
  const testLogger = pino({ level: 'info', redact: REDACT }, sink);
  testLogger.info({ req: { headers: { authorization: 'Bearer secret', cookie: 'sid=xyz', 'user-agent': 'x' } } }, 'req');
  setImmediate(() => {
    expect(out).not.toContain('Bearer secret');
    expect(out).not.toContain('sid=xyz');
    expect(out).toContain('user-agent');
    done();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- logger.test.js`
Expected: FAIL — `Cannot find module './logger'`.

- [ ] **Step 4: Write the logger module**

Create `src/shared/observability/logger.js`:
```javascript
// Central (and only) logging integration point. Structured JSON via pino;
// silent under test so the Jest suite stays quiet; pretty-printed in dev.
// Mirrors the sentry.js "one integration point" convention.
const crypto = require('crypto');
const pino = require('pino');
const pinoHttp = require('pino-http');

const isTest = process.env.NODE_ENV === 'test';
const isDev = process.env.NODE_ENV !== 'production' && !isTest;

// Never let the access token or session cookie reach the logs.
const REDACT = { paths: ['req.headers.authorization', 'req.headers.cookie'], remove: true };

const logger = pino({
  level: isTest ? 'silent' : (process.env.LOG_LEVEL || 'info'),
  redact: REDACT,
  // pino-pretty runs in a worker thread — dev only, never in prod or test.
  transport: isDev
    ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' } }
    : undefined,
});

// Honor an inbound correlation id (proxy/trace propagation), else generate one.
// Echo it back so callers/clients can correlate. Runs for every request.
function genReqId(req, res) {
  const incoming = req.headers && req.headers['x-request-id'];
  const id = (typeof incoming === 'string' && incoming) || crypto.randomUUID();
  res.setHeader('X-Request-Id', id);
  return id;
}

// Health/version endpoints are high-frequency and low-signal — skip the
// per-request completion log (genReqId + header still run). Matches the paths
// already excluded from rate limiting; both /api and /api/v1 mounts covered.
function ignore(req) {
  const path = (req.url || '').split('?')[0];
  return path.endsWith('/health') || path.endsWith('/health/deep') || path.endsWith('/version');
}

const httpLogger = pinoHttp({ logger, genReqId, autoLogging: { ignore } });

module.exports = { logger, httpLogger, genReqId, REDACT };
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- logger.test.js`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/shared/observability/logger.js src/shared/observability/logger.test.js
git commit -m "feat(observability): add pino logger module with requestId + redaction"
```

---

### Task 2: Mount httpLogger + requestId header in app.js

**Files:**
- Modify: `src/app.js`
- Test: `tests/logging.test.js` (create)

**Interfaces:**
- Consumes: `httpLogger` from `src/shared/observability/logger.js`.
- Produces: every response carries an `X-Request-Id` header; every request gets a `req.log` child logger and `req.id`.

- [ ] **Step 1: Write the failing test**

Create `tests/logging.test.js`:
```javascript
const { agent } = require('./helpers/testApp');

test('every response carries an X-Request-Id header', async () => {
  const res = await agent().get('/api/health');
  expect(res.status).toBe(200);
  expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
});

test('an inbound X-Request-Id is echoed back', async () => {
  const res = await agent().get('/api/health').set('X-Request-Id', 'trace-xyz');
  expect(res.headers['x-request-id']).toBe('trace-xyz');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- logging.test.js`
Expected: FAIL — `x-request-id` header undefined (does not match regex).

- [ ] **Step 3: Mount the middleware**

In `src/app.js`, add the require alongside the other `require` lines near the top:
```javascript
const { httpLogger } = require('./shared/observability/logger');
```

Then mount it immediately after the `trust proxy` block and before `helmet`, so it wraps the whole request. The relevant region becomes:
```javascript
if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);

// Structured request logging + per-request correlation id (must run first so it
// times the full request and every response carries X-Request-Id).
app.use(httpLogger);

// Security headers. cross-origin RP so the SPA on another origin can read responses.
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- logging.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app.js tests/logging.test.js
git commit -m "feat(observability): mount pino-http with requestId header propagation"
```

---

### Task 3: Structured error logging + Sentry requestId correlation

**Files:**
- Modify: `src/shared/observability/sentry.js:31-34` (the `captureError` function)
- Modify: `src/shared/middleware/error.js`
- Test: existing `tests/errorCapture.test.js` (must stay green), existing `src/shared/observability/sentry.test.js` (must stay green)

**Interfaces:**
- Consumes: `logger` from `src/shared/observability/logger.js`; `req.log` and `req.id` provided by Task 2's middleware.
- Produces: `captureError(err, context?)` where `context` is optional `{ requestId?: string }`; when `requestId` is present it is attached as a Sentry `request_id` tag. Backward compatible — `captureError(err)` behaves exactly as before.

- [ ] **Step 1: Update captureError to accept a requestId tag**

In `src/shared/observability/sentry.js`, replace the `captureError` function:
```javascript
function captureError(err, context) {
  if (!enabled) return;
  if (context && context.requestId) {
    Sentry.captureException(err, { tags: { request_id: context.requestId } });
  } else {
    Sentry.captureException(err);
  }
}
```
(No change to the `module.exports` line — `captureError` is already exported.)

- [ ] **Step 2: Verify existing Sentry unit test still passes**

Run: `npm test -- observability/sentry.test.js`
Expected: PASS — `captureError(err)` still calls `captureException(err)` with a single arg (the `toHaveBeenCalledWith(err)` assertion holds because no context is passed).

- [ ] **Step 3: Migrate error.js to structured logging + pass requestId**

Replace the full contents of `src/shared/middleware/error.js`:
```javascript
const { AppError } = require('../utils/errors');
const { captureError } = require('../observability/sentry');
const { logger } = require('../observability/logger');

function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  const log = req.log || logger; // req.log is absent in bare-express unit tests
  if (err instanceof AppError) {
    if (err.status >= 500) captureError(err, { requestId: req.id });
    return res.status(err.status).json({
      error: {
        message: err.message,
        code: err.code,
        ...(err.details ? { details: err.details } : {}),
      },
    });
  }
  captureError(err, { requestId: req.id });
  log.error({ err }, 'unhandled error');
  return res.status(500).json({ error: { message: 'Internal server error', code: 'INTERNAL' } });
}

module.exports = { errorHandler };
```

- [ ] **Step 4: Verify error-capture behavior unchanged**

Run: `npm test -- errorCapture.test.js`
Expected: PASS (3 tests). The bare-express app in that test has no `req.log` (falls back to silent `logger`) and no `req.id` (so `context.requestId` is undefined → single-arg capture); call counts are unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/shared/observability/sentry.js src/shared/middleware/error.js
git commit -m "feat(observability): structured error logging + Sentry request_id tag"
```

---

### Task 4: Migrate remaining console.* calls to the logger

**Files:**
- Modify: `src/server.js:8`
- Modify: `src/shared/storage/index.js:29`
- Modify: `src/modules/postings/postings.service.js:93`
- Modify: `src/modules/analysis/analysis.service.js` (lines 67, 184, 220, 261)
- Modify: `src/modules/documents/documents.service.js:31`
- Modify: `src/modules/images/images.controller.js` (line 5 DBG const, line 17)
- Modify: `src/modules/authored-documents/authored-documents.controller.js` (line 4 DBG const, lines 19, 29-30)

**Interfaces:**
- Consumes: `logger` from `src/shared/observability/logger.js`.
- Produces: zero `console.*` calls remain in `src/`.

- [ ] **Step 1: server.js startup log**

In `src/server.js`, add near the top (after the existing requires):
```javascript
const { logger } = require('./shared/observability/logger');
```
Replace line 8:
```javascript
app.listen(port, () => logger.info({ port }, `API listening on :${port}`));
```

- [ ] **Step 2: storage/index.js**

In `src/shared/storage/index.js`, add at the top with the other requires:
```javascript
const { logger } = require('../observability/logger');
```
Replace the `console.error` line:
```javascript
        logger.error({ err, key }, `[storage] read failed for ${key}`);
```

- [ ] **Step 3: postings.service.js**

In `src/modules/postings/postings.service.js`, add with the other requires:
```javascript
const { logger } = require('../../shared/observability/logger');
```
Replace line 93:
```javascript
    logger.warn({ err, kind: err.kind || 'unknown' }, '[postings] AI parse failed');
```

- [ ] **Step 4: analysis.service.js (4 sites)**

In `src/modules/analysis/analysis.service.js`, add with the other requires:
```javascript
const { logger } = require('../../shared/observability/logger');
```
Replace each `console.warn`:

Line 67:
```javascript
        logger.warn({ err, kind: err.kind || 'unknown', model }, '[analysis] AI analysis unavailable; falling back to deterministic match');
```
Line 184:
```javascript
    logger.warn({ err, kind: err.kind || 'unknown' }, '[cover-letter] AI generation failed');
```
Line 220:
```javascript
    logger.warn({ err, kind: err.kind || 'unknown' }, '[tailor] retrieval failed');
```
Line 261:
```javascript
    logger.warn({ err, kind: err.kind || 'unknown' }, '[tailor] AI generation failed');
```

- [ ] **Step 5: documents.service.js**

In `src/modules/documents/documents.service.js`, add with the other requires:
```javascript
const { logger } = require('../../shared/observability/logger');
```
Replace line 31's `.catch(...)`:
```javascript
      indexDocument(userId, doc.id).catch((err) => logger.warn({ err, docId: doc.id }, '[rag] index-on-upload failed'));
```

- [ ] **Step 6: images.controller.js (retire DBG, use logger.debug)**

In `src/modules/images/images.controller.js`, add with the other requires:
```javascript
const { logger } = require('../../shared/observability/logger');
```
Delete the DBG constant (line 5):
```javascript
const DBG = process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test'; // temporary editor-image debug logging (dev only)
```
Replace line 17:
```javascript
    logger.debug({ id: image.id, type: image.mimeType, bytes: image.sizeBytes, url }, '[editor-debug] image uploaded');
```

- [ ] **Step 7: authored-documents.controller.js (retire DBG, use logger.debug)**

In `src/modules/authored-documents/authored-documents.controller.js`, add with the other requires:
```javascript
const { logger } = require('../../shared/observability/logger');
```
Delete the DBG constant (line 4):
```javascript
const DBG = process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test';
```
Replace line 19:
```javascript
    logger.debug({ id: req.params.id, imageNodes: countImages(doc.content) }, '[editor-debug] GET saved content');
```
Replace the DBG-gated block at lines 29-31 (`if (DBG && req.body && ...) { console.log(...); }`) with a content-presence-guarded debug log:
```javascript
    if (req.body && Object.prototype.hasOwnProperty.call(req.body, 'content')) {
      logger.debug({ id: req.params.id, imageNodes: countImages(req.body.content), title: req.body.title }, '[editor-debug] PATCH content');
    }
```

- [ ] **Step 8: Verify no console.* remain and modules still load**

Run:
```bash
grep -rn "console\." src && echo "FOUND console.* — fix above" || echo "clean: no console.* in src"
```
Expected: `clean: no console.* in src`.

- [ ] **Step 9: Commit**

```bash
git add src/server.js src/shared/storage/index.js src/modules/postings/postings.service.js src/modules/analysis/analysis.service.js src/modules/documents/documents.service.js src/modules/images/images.controller.js src/modules/authored-documents/authored-documents.controller.js
git commit -m "refactor(observability): migrate all console.* calls to pino logger"
```

---

### Task 5: Full-suite verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: PASS for all logging/observability/error/meta/health suites, and **no new stdout noise** from logs (level `silent` under test). Pre-existing parallel-DB-schema flakiness (P1 finding) may intermittently fail unrelated module suites (applications/contacts/analysis/etc.); if any fail, re-run those in isolation to confirm they pass (`npm test -- <name> --runInBand`) and that the failure is the known flakiness, not this change.

- [ ] **Step 2: Sanity-check dev output shape (manual, optional)**

Run:
```bash
LOG_LEVEL=debug NODE_ENV=development node -e "const { logger } = require('./src/shared/observability/logger'); logger.info({ hello: 'world' }, 'pretty check');"
```
Expected: a single colorized pino-pretty line (proves the dev transport works). In production (`NODE_ENV=production`) the same call emits one JSON object.

- [ ] **Step 3: Final commit (only if any fixups were needed)**

```bash
git add -A && git commit -m "chore(observability): finalize structured logging"
```
(Skip if the working tree is already clean.)

---

## Self-Review

**Spec coverage:**
- Logger module + config (level/format/redaction) → Task 1 ✓
- pino/pino-http/pino-pretty deps → Task 1 Step 1 ✓
- httpLogger mounted early + requestId (honor inbound, echo header) + health ignore → Task 1 (genReqId/ignore) + Task 2 (mount/tests) ✓
- Error path structured logging + Sentry correlation → Task 3 ✓ (implemented as a capture-time tag rather than global-scope mutation, because there is no Sentry request-isolation middleware — avoids cross-request scope leakage; same observable outcome: the error carries `request_id`)
- Migrate all console.* (server, error, storage, postings, analysis×4, documents, 2 editor-debug) → Task 3 (error.js) + Task 4 (the rest) ✓
- Retire DBG flag → Task 4 Steps 6–7 ✓
- logger.test.js (silent level, requestId gen/honor, redaction) + header assertion → Task 1 + Task 2 ✓
- Suite stays green / no stdout pollution → Task 5 ✓

**Placeholder scan:** none — every code step shows full code; every run step shows the command + expected output.

**Type consistency:** `logger`, `httpLogger`, `genReqId`, `REDACT` named identically across Tasks 1–4. `captureError(err, context?)` signature defined in Task 3 Step 1 and used with `{ requestId: req.id }` in Task 3 Step 3. `req.log` / `req.id` produced by Task 2's `httpLogger`, consumed by Task 3's `error.js`.
