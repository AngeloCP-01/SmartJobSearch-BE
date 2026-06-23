const { hashPassword, verifyPassword } = require('../src/shared/utils/password');
const {
  signAccessToken, verifyAccessToken, signRefreshToken, verifyRefreshToken,
} = require('../src/shared/utils/jwt');

test('password hashes and verifies', async () => {
  const hash = await hashPassword('Password123');
  expect(hash).not.toBe('Password123');
  expect(await verifyPassword('Password123', hash)).toBe(true);
  expect(await verifyPassword('wrong', hash)).toBe(false);
});

test('access token round-trips the user id', () => {
  const token = signAccessToken('user-1');
  expect(verifyAccessToken(token).sub).toBe('user-1');
});

test('refresh token round-trips user id and jti', () => {
  const token = signRefreshToken('user-1', 'jti-1');
  const payload = verifyRefreshToken(token);
  expect(payload.sub).toBe('user-1');
  expect(payload.jti).toBe('jti-1');
});
