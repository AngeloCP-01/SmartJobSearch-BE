jest.mock('../../shared/database/prisma', () => ({ $queryRaw: jest.fn() }));
jest.mock('../../shared/storage', () => ({ ping: jest.fn() }));
jest.mock('../analysis/engine/embeddings', () => ({ embed: jest.fn() }));

const prisma = require('../../shared/database/prisma');
const storage = require('../../shared/storage');
const { embed } = require('../analysis/engine/embeddings');

const loadFresh = () => {
  let mod;
  jest.isolateModules(() => { mod = require('./health.service'); });
  return mod;
};

beforeEach(() => {
  prisma.$queryRaw.mockReset().mockResolvedValue([{ '?column?': 1 }]);
  storage.ping.mockReset().mockResolvedValue(true);
  embed.mockReset().mockResolvedValue([[0.1, 0.2]]);
});

test('all checks pass → 200 ok', async () => {
  const { deepHealth } = loadFresh();
  const { httpStatus, body } = await deepHealth();
  expect(httpStatus).toBe(200);
  expect(body.status).toBe('ok');
  expect(body.checks.db.ok).toBe(true);
  expect(body.checks.storage.ok).toBe(true);
  expect(body.checks.ai.ok).toBe(true);
});

test('db failure → 503 error', async () => {
  prisma.$queryRaw.mockRejectedValue(new Error('conn refused'));
  const { deepHealth } = loadFresh();
  const { httpStatus, body } = await deepHealth();
  expect(httpStatus).toBe(503);
  expect(body.status).toBe('error');
  expect(body.checks.db.ok).toBe(false);
});

test('storage failure → 503 error', async () => {
  storage.ping.mockRejectedValue(new Error('bucket paused'));
  const { deepHealth } = loadFresh();
  const { httpStatus, body } = await deepHealth();
  expect(httpStatus).toBe(503);
  expect(body.status).toBe('error');
  expect(body.checks.storage.ok).toBe(false);
});

test('ai-only failure → 200 degraded', async () => {
  embed.mockRejectedValue(new Error('rate limited'));
  const { deepHealth } = loadFresh();
  const { httpStatus, body } = await deepHealth();
  expect(httpStatus).toBe(200);
  expect(body.status).toBe('degraded');
  expect(body.checks.ai.ok).toBe(false);
  expect(body.checks.db.ok).toBe(true);
});

test('ai result is cached across calls (only one live ping)', async () => {
  const { deepHealth } = loadFresh();
  await deepHealth();
  await deepHealth();
  expect(embed).toHaveBeenCalledTimes(1);
  const second = await deepHealth();
  expect(second.body.checks.ai.cached).toBe(true);
});

// --- DB probe throttling (2026-08-20) ---
// Each live `SELECT 1` wakes Neon and restarts its 5-min scale-to-zero timer,
// so an uncached probe on a 5-min monitor pins compute on 24/7. These pin the
// throttle that makes the endpoint safe to poll.

test('db result is cached across calls (only one live query)', async () => {
  const { deepHealth } = loadFresh();
  await deepHealth();
  await deepHealth();
  await deepHealth();
  expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
});

test('a cached db result is marked cached', async () => {
  const { deepHealth } = loadFresh();
  const first = await deepHealth();
  const second = await deepHealth();
  expect(first.body.checks.db.cached).toBe(false);
  expect(second.body.checks.db.cached).toBe(true);
});

test('a failed db check is not cached, so recovery is visible next call', async () => {
  prisma.$queryRaw.mockRejectedValue(new Error('conn refused'));
  const { deepHealth } = loadFresh();
  const down = await deepHealth();
  expect(down.httpStatus).toBe(503);

  prisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);
  const recovered = await deepHealth();
  expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
  expect(recovered.httpStatus).toBe(200);
  expect(recovered.body.checks.db.ok).toBe(true);
});

test('fresh option bypasses the db cache', async () => {
  const { deepHealth } = loadFresh();
  await deepHealth();
  const forced = await deepHealth({ fresh: true });
  expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
  expect(forced.body.checks.db.cached).toBe(false);
});

test('fresh option bypasses the ai cache', async () => {
  const { deepHealth } = loadFresh();
  await deepHealth();
  const forced = await deepHealth({ fresh: true });
  expect(embed).toHaveBeenCalledTimes(2);
  expect(forced.body.checks.ai.cached).toBe(false);
});
