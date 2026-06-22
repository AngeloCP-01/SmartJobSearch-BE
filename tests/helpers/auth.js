const { agent } = require('./testApp');

async function registerAndLogin(overrides = {}) {
  const creds = {
    email: `user-${Math.random().toString(36).slice(2)}@example.com`,
    password: 'Password123',
    name: 'Test User',
    ...overrides,
  };
  const reg = await agent().post('/api/auth/register').send(creds);
  return {
    token: reg.body.accessToken,
    cookie: reg.headers['set-cookie'],
    user: reg.body.user,
    creds,
  };
}

module.exports = { registerAndLogin };
