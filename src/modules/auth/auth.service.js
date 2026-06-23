const crypto = require('crypto');
const prisma = require('../../shared/database/prisma');
const { hashPassword, verifyPassword } = require('../../shared/utils/password');
const {
  signAccessToken, signRefreshToken, verifyRefreshToken, REFRESH_TTL_DAYS,
} = require('../../shared/utils/jwt');
const {
  ConflictError, UnauthorizedError, NotFoundError,
} = require('../../shared/utils/errors');

const hashToken = (jti) => crypto.createHash('sha256').update(jti).digest('hex');
const publicUser = (u) => ({ id: u.id, email: u.email, name: u.name, createdAt: u.createdAt });

async function issueTokens(userId) {
  const jti = crypto.randomUUID();
  const refreshToken = signRefreshToken(userId, jti);
  const expiresAt = new Date(Date.now() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000);
  await prisma.refreshToken.create({ data: { userId, tokenHash: hashToken(jti), expiresAt } });
  return { accessToken: signAccessToken(userId), refreshToken };
}

async function register({ email, password, name }) {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw new ConflictError('Email already registered');
  const user = await prisma.user.create({
    data: { email, passwordHash: await hashPassword(password), name },
  });
  return { user: publicUser(user), ...(await issueTokens(user.id)) };
}

async function login({ email, password }) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    throw new UnauthorizedError('Invalid credentials');
  }
  // Reap this user's expired refresh tokens so the table can't grow unbounded.
  await prisma.refreshToken.deleteMany({
    where: { userId: user.id, expiresAt: { lt: new Date() } },
  });
  return { user: publicUser(user), ...(await issueTokens(user.id)) };
}

async function refresh(refreshToken) {
  if (!refreshToken) throw new UnauthorizedError('Missing refresh token');
  let payload;
  try { payload = verifyRefreshToken(refreshToken); } catch (e) {
    throw new UnauthorizedError('Invalid refresh token');
  }

  const stored = await prisma.refreshToken.findFirst({
    where: { tokenHash: hashToken(payload.jti), userId: payload.sub },
  });
  if (!stored) {
    // Valid signature but the token isn't in the store: it was already rotated
    // or logged out. Treat as reuse and revoke the user's whole token family.
    await prisma.refreshToken.deleteMany({ where: { userId: payload.sub } });
    throw new UnauthorizedError('Invalid refresh token');
  }
  if (stored.expiresAt < new Date()) {
    await prisma.refreshToken.deleteMany({ where: { id: stored.id } });
    throw new UnauthorizedError('Invalid refresh token');
  }
  // Atomically consume the token. deleteMany is idempotent — it won't throw
  // P2025 if a concurrent refresh already rotated this row away. Only the caller
  // that actually deletes it (count === 1) may mint new tokens; a racing loser
  // gets a clean 401 instead of crashing the request.
  const { count } = await prisma.refreshToken.deleteMany({ where: { id: stored.id } });
  if (count === 0) throw new UnauthorizedError('Invalid refresh token');
  return issueTokens(payload.sub);
}

async function logout(refreshToken) {
  if (!refreshToken) return;
  let payload;
  try { payload = verifyRefreshToken(refreshToken); } catch (e) { return; }
  await prisma.refreshToken.deleteMany({
    where: { tokenHash: hashToken(payload.jti), userId: payload.sub },
  });
}

async function getMe(userId) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new NotFoundError('User not found');
  return publicUser(user);
}

module.exports = {
  register, login, refresh, logout, getMe, issueTokens, hashToken, publicUser,
};
