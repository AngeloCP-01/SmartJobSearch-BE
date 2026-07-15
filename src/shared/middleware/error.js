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
