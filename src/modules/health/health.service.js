const prisma = require('../../shared/database/prisma');
const storage = require('../../shared/storage');
const { embed } = require('../analysis/engine/embeddings');
const { version } = require('../../../package.json');

const CHECK_TIMEOUT_MS = Number(process.env.HEALTH_CHECK_TIMEOUT_MS || 5000);
const AI_CACHE_MS = Number(process.env.HEALTH_AI_CACHE_MS || 12 * 60 * 1000);

const commit = process.env.RENDER_GIT_COMMIT || process.env.COMMIT_SHA || 'dev';

// Reject if `promise` doesn't settle within `ms` — bounds each dependency check
// so one hung dependency can't stall the endpoint (and the uptime monitor).
function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    Promise.resolve(promise).then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

// Run one check, always resolving to { ok, ms, ...extra } — never throws.
async function timed(label, fn) {
  const start = Date.now();
  try {
    await withTimeout(fn(), CHECK_TIMEOUT_MS, label);
    return { ok: true, ms: Date.now() - start };
  } catch (err) {
    return { ok: false, ms: Date.now() - start, detail: err.message };
  }
}

function checkDb() {
  return timed('db', () => prisma.$queryRaw`SELECT 1`);
}

function checkStorage() {
  return timed('storage', () => storage.ping());
}

// Live but throttled AI probe: a tiny embeddings call (reliable NVIDIA path,
// non-generation). Cached ~12 min so the 5-min uptime poll doesn't re-ping.
let aiCache = { at: 0, result: null };
async function checkAi() {
  const now = Date.now();
  if (aiCache.result && now - aiCache.at < AI_CACHE_MS) {
    return { ...aiCache.result, cached: true };
  }
  const result = await timed('ai', () => embed(['ping'], 'query'));
  aiCache = { at: now, result };
  return { ...result, cached: false };
}

async function deepHealth() {
  const [db, storageCheck, ai] = await Promise.all([checkDb(), checkStorage(), checkAi()]);
  const criticalOk = db.ok && storageCheck.ok;
  const status = !criticalOk ? 'error' : (ai.ok ? 'ok' : 'degraded');
  const httpStatus = criticalOk ? 200 : 503;
  return {
    httpStatus,
    body: { status, checks: { db, storage: storageCheck, ai }, version, commit },
  };
}

module.exports = { deepHealth };
