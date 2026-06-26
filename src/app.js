const express = require('express');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const routes = require('./routes');
const { errorHandler } = require('./shared/middleware/error');

const app = express();

// Behind a hosting proxy (Render/Fly/etc.) that terminates TLS — needed so
// req.protocol/req.secure are correct, Secure cookies behave, and the rate
// limiter keys on the real client IP (X-Forwarded-For) rather than the proxy.
if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);

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
  skip: (req) => req.originalUrl.endsWith('/health') || req.originalUrl.endsWith('/version'),
});
const authLimiter = limiter({
  max: 30, // tighter on auth to blunt brute-force/credential-stuffing
  message: { error: { message: 'Too many attempts — please try again later.', code: 'RATE_LIMITED' } },
});

// Canonical versioned mount + an unversioned alias so existing clients keep
// working. The same router is mounted at both prefixes.
for (const base of ['/api/v1', '/api']) {
  app.use(base, apiLimiter);
  app.use(`${base}/auth`, authLimiter);
  app.use(base, routes);
}

app.use(errorHandler);

module.exports = app;
