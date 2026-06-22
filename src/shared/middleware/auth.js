const { verifyAccessToken } = require('../utils/jwt');
const { UnauthorizedError } = require('../utils/errors');

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next(new UnauthorizedError('Missing access token'));
  try {
    const payload = verifyAccessToken(token);
    req.userId = payload.sub;
    return next();
  } catch (e) {
    return next(new UnauthorizedError('Invalid access token'));
  }
}

module.exports = { requireAuth };
