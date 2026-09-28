class AppError extends Error {
  // `options.cause` keeps the internal error behind a user-facing message so
  // logs/Sentry see the real reason (e.g. which AI models failed and why).
  constructor(message, status = 500, code = 'INTERNAL', options) {
    super(message, options);
    this.status = status;
    this.code = code;
  }
}

class NotFoundError extends AppError {
  constructor(message = 'Not found') { super(message, 404, 'NOT_FOUND'); }
}
class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') { super(message, 401, 'UNAUTHORIZED'); }
}
class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') { super(message, 403, 'FORBIDDEN'); }
}
class ConflictError extends AppError {
  constructor(message = 'Conflict') { super(message, 409, 'CONFLICT'); }
}
class ValidationError extends AppError {
  constructor(message = 'Validation failed', details = []) {
    super(message, 400, 'VALIDATION');
    this.details = details;
  }
}

module.exports = {
  AppError, NotFoundError, UnauthorizedError, ForbiddenError, ConflictError, ValidationError,
};
