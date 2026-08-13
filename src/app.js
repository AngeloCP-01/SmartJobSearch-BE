const express = require('express');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const routes = require('./routes');
const v2Routes = require('./routes/v2');
const { errorHandler } = require('./shared/middleware/error');
const { httpLogger } = require('./shared/observability/logger');

const app = express();

// Behind a hosting proxy (Render/Fly/etc.) that terminates TLS — needed so
// req.protocol/req.secure are correct, Secure cookies behave, and the rate
// limiter keys on the real client IP (X-Forwarded-For) rather than the proxy.
if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);

// Structured request logging + per-request correlation id (must run first so it
// times the full request and every response carries X-Request-Id).
app.use(httpLogger);

// Security headers. cross-origin RP so the SPA on another origin can read responses.
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({ origin: process.env.CORS_ORIGIN || true, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

// Rate limiting — a no-op under test so the integration suite isn't throttled.
const limiter = (opts) => (process.env.NODE_ENV === 'test'
  ? (req, res, next) => next()
  : rateLimit({ windowMs: 15 * 60 * 1000, standardHeaders: true, legacyHeaders: false, ...opts }));

const apiLimiter = limiter({
  max: 600, // generous per-IP ceiling; health/version excluded (keep-alive + Render checks)
  skip: (req) => req.originalUrl.endsWith('/health')
    || req.originalUrl.endsWith('/health/deep')
    || req.originalUrl.endsWith('/version'),
});
const authLimiter = limiter({
  max: 30, // tighter on auth to blunt brute-force/credential-stuffing
  message: { error: { message: 'Too many attempts — please try again later.', code: 'RATE_LIMITED' } },
});

// Canonical versioned mounts + an unversioned alias so existing clients keep
// working. v1 and the bare alias share one router; v2 swaps in paginated list
// handlers and falls through to v1 for everything else.
//
// Order is load-bearing. app.use('/api', …) also prefix-matches '/api/v2/...',
// and Express runs every matching app.use in registration order until a
// response is sent — so if v2 came last, each v2 request would pass through
// apiLimiter twice and get half the intended rate budget. Registering v2 first
// means the v2 router responds before the '/api' chain ever runs.
// Guarded by tests/app-mounts.test.js, because the limiter is a no-op under
// NODE_ENV=test and a double-increment is otherwise invisible to the suite.
const API_MOUNTS = [
  { base: '/api/v2', routes: v2Routes },
  { base: '/api/v1', routes },
  { base: '/api', routes },
];

for (const { base, routes: mounted } of API_MOUNTS) {
  app.use(base, apiLimiter);
  app.use(`${base}/auth`, authLimiter);
  app.use(base, mounted);
}

app.use(errorHandler);

module.exports = app;
module.exports.API_MOUNTS = API_MOUNTS;
