// Central (and only) logging integration point. Structured JSON via pino;
// silent under test so the Jest suite stays quiet; pretty-printed in dev.
// Mirrors the sentry.js "one integration point" convention.
const crypto = require('crypto');
const pino = require('pino');
const pinoHttp = require('pino-http');

const isTest = process.env.NODE_ENV === 'test';
const isDev = process.env.NODE_ENV !== 'production' && !isTest;

// Never let the access token, session cookie, or (via pino-http's logged
// response headers) the Set-Cookie refresh-token reach the logs.
const REDACT = { paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'], remove: true };

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

// Compact per-request serializers — pino-http's defaults dump every request and
// response header (huge, noisy, and a redaction surface). We only want the
// signal: id, method, url, and status. responseTime is added by pino-http.
const HTTP_SERIALIZERS = {
  req: (req) => ({ id: req.id, method: req.method, url: req.url }),
  res: (res) => ({ statusCode: res.statusCode }),
};

const httpLogger = pinoHttp({ logger, genReqId, autoLogging: { ignore }, serializers: HTTP_SERIALIZERS });

module.exports = { logger, httpLogger, genReqId, REDACT, HTTP_SERIALIZERS };
