const { agent } = require('./helpers/testApp');

test('GET /api/health reports ok + version', async () => {
  const res = await agent().get('/api/health');
  expect(res.status).toBe(200);
  expect(res.body.status).toBe('ok');
  expect(typeof res.body.version).toBe('string');
});

test('GET /api/version reports version, commit, and uptime', async () => {
  const res = await agent().get('/api/version');
  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({ version: expect.any(String), commit: expect.any(String) });
  expect(typeof res.body.uptime).toBe('number');
});

test('the /api/v1 alias serves the same routes', async () => {
  const res = await agent().get('/api/v1/health');
  expect(res.status).toBe(200);
  expect(res.body.status).toBe('ok');
});

test('/api/v1 resources still enforce auth (401 when unauthenticated)', async () => {
  expect((await agent().get('/api/v1/applications')).status).toBe(401);
});

test('helmet security headers are present', async () => {
  const res = await agent().get('/api/health');
  expect(res.headers['x-content-type-options']).toBe('nosniff');
});
