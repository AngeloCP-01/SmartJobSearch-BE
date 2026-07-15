const { AppError } = require('../utils/errors');
const { captureError } = require('../observability/sentry');
const { logger } = require('../observability/logger');

function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  const log = req.log || logger; // req.log is absent in bare-express unit tests
  if (err instanceof AppError) {
    if (err.status >= 500) {
      captureError(err, { requestId: req.id });
      log.error({ err }, err.message); // server-side failure — surface it locally, not only in Sentry
    } else {
      log.debug({ err }, err.message); // expected client error (4xx) — visible only at debug, keeps info quiet
    }
    return res.status(err.status).json({
      error: {
        message: err.message,
        code: err.code,
        ...(err.details ? { details: err.details } : {}),
      },
    });
  }
  captureError(err, { requestId: req.id });
  log.error({ err }, err.message || 'unhandled error');
  return res.status(500).json({ error: { message: 'Internal server error', code: 'INTERNAL' } });
}

module.exports = { errorHandler };
