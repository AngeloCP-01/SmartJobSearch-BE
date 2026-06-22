const { agent } = require('./helpers/testApp');
const { prisma, resetDb } = require('./helpers/db');
const { registerAndLogin } = require('./helpers/auth');

beforeEach(resetDb);
afterAll(async () => { await prisma.$disconnect(); });

const creds = { email: 'ada@example.com', password: 'Password123', name: 'Ada' };

function refreshCookie(setCookie) {
  return setCookie.find((c) => c.startsWith('refreshToken='));
}

// --- register / login ---

test('register creates a user and returns an access token + refresh cookie', async () => {
  const res = await agent().post('/api/auth/register').send(creds);
  expect(res.status).toBe(201);
  expect(res.body.user).toMatchObject({ email: creds.email, name: creds.name });
  expect(res.body.user.passwordHash).toBeUndefined();
  expect(typeof res.body.accessToken).toBe('string');
  expect(res.headers['set-cookie'].join(';')).toMatch(/refreshToken=/);
});

test('register rejects a duplicate email with 409', async () => {
  await agent().post('/api/auth/register').send(creds);
  const res = await agent().post('/api/auth/register').send(creds);
  expect(res.status).toBe(409);
  expect(res.body.error.code).toBe('CONFLICT');
});

test('register rejects invalid input with 400', async () => {
  const res = await agent().post('/api/auth/register').send({ email: 'nope', password: '123' });
  expect(res.status).toBe(400);
  expect(res.body.error.code).toBe('VALIDATION');
});

test('login returns a token for valid credentials', async () => {
  await agent().post('/api/auth/register').send(creds);
  const res = await agent().post('/api/auth/login').send({ email: creds.email, password: creds.password });
  expect(res.status).toBe(200);
  expect(typeof res.body.accessToken).toBe('string');
});

test('login rejects a wrong password with 401', async () => {
  await agent().post('/api/auth/register').send(creds);
  const res = await agent().post('/api/auth/login').send({ email: creds.email, password: 'wrong' });
  expect(res.status).toBe(401);
  expect(res.body.error.code).toBe('UNAUTHORIZED');
});

// --- /me ---

test('GET /auth/me returns the current user with a valid token', async () => {
  const { token, user } = await registerAndLogin();
  const res = await agent().get('/api/auth/me').set('Authorization', `Bearer ${token}`);
  expect(res.status).toBe(200);
  expect(res.body.user.id).toBe(user.id);
});

test('GET /auth/me without a token returns 401', async () => {
  const res = await agent().get('/api/auth/me');
  expect(res.status).toBe(401);
  expect(res.body.error.code).toBe('UNAUTHORIZED');
});

test('GET /auth/me with a bad token returns 401', async () => {
  const res = await agent().get('/api/auth/me').set('Authorization', 'Bearer garbage');
  expect(res.status).toBe(401);
});

// --- refresh / logout ---

test('refresh issues a new access token from the refresh cookie', async () => {
  const { cookie } = await registerAndLogin();
  const res = await agent().post('/api/auth/refresh').set('Cookie', refreshCookie(cookie));
  expect(res.status).toBe(200);
  expect(typeof res.body.accessToken).toBe('string');
  expect(res.headers['set-cookie'].join(';')).toMatch(/refreshToken=/);
});

test('refresh without a cookie returns 401', async () => {
  const res = await agent().post('/api/auth/refresh');
  expect(res.status).toBe(401);
});

test('refresh fails after logout (token invalidated)', async () => {
  const { cookie } = await registerAndLogin();
  const c = refreshCookie(cookie);
  const logout = await agent().post('/api/auth/logout').set('Cookie', c);
  expect(logout.status).toBe(204);
  const res = await agent().post('/api/auth/refresh').set('Cookie', c);
  expect(res.status).toBe(401);
});

test('a refresh token cannot be reused after rotation', async () => {
  const { cookie } = await registerAndLogin();
  const c = refreshCookie(cookie);
  const first = await agent().post('/api/auth/refresh').set('Cookie', c);
  expect(first.status).toBe(200);
  const reuse = await agent().post('/api/auth/refresh').set('Cookie', c);
  expect(reuse.status).toBe(401);
});
