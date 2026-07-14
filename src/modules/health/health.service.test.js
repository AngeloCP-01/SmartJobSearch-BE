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
