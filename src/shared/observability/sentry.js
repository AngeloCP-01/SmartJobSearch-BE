// Central (and only) Sentry integration point. Fully no-op unless SENTRY_DSN is
// set, so local dev and the test suite make no network calls and need no config.
const Sentry = require('@sentry/node');

let enabled = false;

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

// beforeSend hook: strip credentials so JWTs / auth headers never leave the box.
function scrub(event) {
  if (event && event.request) {
    if (event.request.cookies) delete event.request.cookies;
    const h = event.request.headers;
    if (h) {
      for (const name of ['authorization', 'Authorization', 'cookie', 'Cookie']) {
        delete h[name];
      }
    }
  }
  return event;
}

function initSentry() {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return; // unconfigured → stay inert
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || 'development',
    release: process.env.RENDER_GIT_COMMIT || process.env.COMMIT_SHA || undefined,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || 0),
    beforeSend: scrub,
  });
  enabled = true;
}

function captureError(err, context) {
  if (!enabled) return;
  if (context && context.requestId) {
    Sentry.captureException(err, { tags: { request_id: context.requestId } });
  } else {
    Sentry.captureException(err);
  }
}

module.exports = { initSentry, captureError, scrub, scrubLog };
