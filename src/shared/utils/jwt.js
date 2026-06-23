const jwt = require('jsonwebtoken');

const ACCESS_TTL = '15m';
const REFRESH_TTL_DAYS = 7;

const signAccessToken = (userId) =>
  jwt.sign({ sub: userId }, process.env.JWT_ACCESS_SECRET, { expiresIn: ACCESS_TTL });

const verifyAccessToken = (token) => jwt.verify(token, process.env.JWT_ACCESS_SECRET);

const signRefreshToken = (userId, jti) =>
  jwt.sign({ sub: userId, jti }, process.env.JWT_REFRESH_SECRET, {
    expiresIn: `${REFRESH_TTL_DAYS}d`,
  });

const verifyRefreshToken = (token) => jwt.verify(token, process.env.JWT_REFRESH_SECRET);

module.exports = {
  signAccessToken, verifyAccessToken, signRefreshToken, verifyRefreshToken, REFRESH_TTL_DAYS,
};
