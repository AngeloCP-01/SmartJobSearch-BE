const { AppError } = require('../utils/errors');
const { captureError } = require('../observability/sentry');

function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  if (err instanceof AppError) {
    if (err.status >= 500) captureError(err);
    return res.status(err.status).json({
      error: {
        message: err.message,
        code: err.code,
        ...(err.details ? { details: err.details } : {}),
      },
    });
  }
  captureError(err);
  console.error(err);
  return res.status(500).json({ error: { message: 'Internal server error', code: 'INTERNAL' } });
}

module.exports = { errorHandler };
