const { agent } = require('./helpers/testApp');

test('every response carries an X-Request-Id header', async () => {
  const res = await agent().get('/api/health');
  expect(res.status).toBe(200);
  expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
});

test('an inbound X-Request-Id is echoed back', async () => {
  const res = await agent().get('/api/health').set('X-Request-Id', 'trace-xyz');
  expect(res.headers['x-request-id']).toBe('trace-xyz');
});
