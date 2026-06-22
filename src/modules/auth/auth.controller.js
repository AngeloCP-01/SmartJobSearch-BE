const authService = require('./auth.service');

const REFRESH_COOKIE = 'refreshToken';

const cookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/api/auth',
  maxAge: 7 * 24 * 60 * 60 * 1000,
});

async function register(req, res, next) {
  try {
    const { user, accessToken, refreshToken } = await authService.register(req.body);
    res.cookie(REFRESH_COOKIE, refreshToken, cookieOptions());
    res.status(201).json({ user, accessToken });
  } catch (e) { next(e); }
}

async function login(req, res, next) {
  try {
    const { user, accessToken, refreshToken } = await authService.login(req.body);
    res.cookie(REFRESH_COOKIE, refreshToken, cookieOptions());
    res.json({ user, accessToken });
  } catch (e) { next(e); }
}

async function refresh(req, res, next) {
  try {
    const { accessToken, refreshToken } = await authService.refresh(req.cookies[REFRESH_COOKIE]);
    res.cookie(REFRESH_COOKIE, refreshToken, cookieOptions());
    res.json({ accessToken });
  } catch (e) { next(e); }
}

async function logout(req, res, next) {
  try {
    await authService.logout(req.cookies[REFRESH_COOKIE]);
    res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
    res.status(204).end();
  } catch (e) { next(e); }
}

async function me(req, res, next) {
  try {
    res.json({ user: await authService.getMe(req.userId) });
  } catch (e) { next(e); }
}

module.exports = { register, login, refresh, logout, me, REFRESH_COOKIE, cookieOptions };
