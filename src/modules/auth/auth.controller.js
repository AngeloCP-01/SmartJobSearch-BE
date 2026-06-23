const authService = require('./auth.service');
const { REMEMBER_TTL_DAYS } = require('../../shared/utils/jwt');

const REFRESH_COOKIE = 'refreshToken';

// Persistent ("remember me") → a Max-Age cookie that survives browser restarts.
// Otherwise a session cookie (no Max-Age) that's cleared when the browser closes.
const cookieOptions = (rememberMe = false) => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/api/auth',
  ...(rememberMe ? { maxAge: REMEMBER_TTL_DAYS * 24 * 60 * 60 * 1000 } : {}),
});

async function register(req, res, next) {
  try {
    const { user, accessToken, refreshToken, rememberMe } = await authService.register(req.body);
    res.cookie(REFRESH_COOKIE, refreshToken, cookieOptions(rememberMe));
    res.status(201).json({ user, accessToken });
  } catch (e) { next(e); }
}

async function login(req, res, next) {
  try {
    const { user, accessToken, refreshToken, rememberMe } = await authService.login(req.body);
    res.cookie(REFRESH_COOKIE, refreshToken, cookieOptions(rememberMe));
    res.json({ user, accessToken });
  } catch (e) { next(e); }
}

async function refresh(req, res, next) {
  try {
    const { accessToken, refreshToken, rememberMe } = await authService.refresh(req.cookies[REFRESH_COOKIE]);
    res.cookie(REFRESH_COOKIE, refreshToken, cookieOptions(rememberMe));
    res.json({ accessToken });
  } catch (e) { next(e); }
}

async function logout(req, res, next) {
  try {
    await authService.logout(req.cookies[REFRESH_COOKIE]);
    const { maxAge, ...clearOptions } = cookieOptions();
    res.clearCookie(REFRESH_COOKIE, clearOptions);
    res.status(204).end();
  } catch (e) { next(e); }
}

async function me(req, res, next) {
  try {
    res.json({ user: await authService.getMe(req.userId) });
  } catch (e) { next(e); }
}

module.exports = { register, login, refresh, logout, me, REFRESH_COOKIE, cookieOptions };
