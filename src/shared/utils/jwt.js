const jwt = require('jsonwebtoken');

const ACCESS_TTL = '15m';
// "Remember me" → long-lived persistent session; otherwise a short, session-only one.
const REMEMBER_TTL_DAYS = 30;
const SESSION_TTL_DAYS = 1;
const refreshTtlDays = (rememberMe) => (rememberMe ? REMEMBER_TTL_DAYS : SESSION_TTL_DAYS);

const signAccessToken = (userId) =>
  jwt.sign({ sub: userId }, process.env.JWT_ACCESS_SECRET, { expiresIn: ACCESS_TTL });

const verifyAccessToken = (token) => jwt.verify(token, process.env.JWT_ACCESS_SECRET);

// `rmb` (remember-me) is carried in the token so rotation re-issues with the same lifetime.
const signRefreshToken = (userId, jti, rememberMe = false) =>
  jwt.sign({ sub: userId, jti, rmb: Boolean(rememberMe) }, process.env.JWT_REFRESH_SECRET, {
    expiresIn: `${refreshTtlDays(rememberMe)}d`,
  });

const verifyRefreshToken = (token) => jwt.verify(token, process.env.JWT_REFRESH_SECRET);

module.exports = {
  signAccessToken, verifyAccessToken, signRefreshToken, verifyRefreshToken,
  REMEMBER_TTL_DAYS, SESSION_TTL_DAYS, refreshTtlDays,
};
