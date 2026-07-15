// Central (and only) Sentry integration point. Fully no-op unless SENTRY_DSN is
// set, so local dev and the test suite make no network calls and need no config.
const Sentry = require('@sentry/node');

let enabled = false;

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

module.exports = { initSentry, captureError, scrub };
