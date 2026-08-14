const { API_MOUNTS } = require('../src/app');

// Why this is asserted declaratively rather than by counting requests:
// src/app.js makes the rate limiter a no-op when NODE_ENV === 'test', so a
// double-increment is invisible to the suite. app.use('/api', …) also
// prefix-matches '/api/v2/...', and Express runs every matching app.use in
// registration order until a response is sent — so registration order IS the
// guarantee. Assert the order.
test('/api/v2 is registered before /api so its limiter runs once, not twice', () => {
  const bases = API_MOUNTS.map((m) => m.base);
  expect(bases).toContain('/api/v2');
  expect(bases.indexOf('/api/v2')).toBeLessThan(bases.indexOf('/api'));
});
