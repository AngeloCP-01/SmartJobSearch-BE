const prisma = require('../../shared/database/prisma');
const storage = require('../../shared/storage');
const { embed } = require('../analysis/engine/embeddings');
const { version } = require('../../../package.json');

const CHECK_TIMEOUT_MS = Number(process.env.HEALTH_CHECK_TIMEOUT_MS || 5000);
const AI_CACHE_MS = Number(process.env.HEALTH_AI_CACHE_MS || 12 * 60 * 1000);
// Every live `SELECT 1` wakes Neon and restarts its 5-min scale-to-zero timer,
// so an unthrottled probe on a 5-min monitor pins compute on 24/7 (this burned
// the whole free CU-hour allowance by 2026-08-20). Cache well past that timer
// so polling costs at most one short wake per window.
const DB_CACHE_MS = Number(process.env.HEALTH_DB_CACHE_MS || 60 * 60 * 1000);

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

// Throttled DB probe. Only successes are cached: a failing DB must be re-probed
// every call so recovery shows up immediately — and a down DB burns no compute.
let dbCache = { at: 0, result: null };
async function checkDb(fresh) {
  const now = Date.now();
  if (!fresh && dbCache.result && now - dbCache.at < DB_CACHE_MS) {
    return { ...dbCache.result, cached: true };
  }
  const result = await timed('db', () => prisma.$queryRaw`SELECT 1`);
  if (result.ok) dbCache = { at: now, result };
  return { ...result, cached: false };
}

function checkStorage() {
  return timed('storage', () => storage.ping());
}

// Live but throttled AI probe: a tiny embeddings call (reliable NVIDIA path,
// non-generation). Cached ~12 min so the 5-min uptime poll doesn't re-ping.
let aiCache = { at: 0, result: null };
async function checkAi(fresh) {
  const now = Date.now();
  if (!fresh && aiCache.result && now - aiCache.at < AI_CACHE_MS) {
    return { ...aiCache.result, cached: true };
  }
  const result = await timed('ai', () => embed(['ping'], 'query'));
  aiCache = { at: now, result };
  return { ...result, cached: false };
}

// `fresh` forces live probes past both caches — for on-demand diagnostics
// (GET /api/health/deep?fresh=1), never for the uptime monitor.
async function deepHealth({ fresh = false } = {}) {
  const [db, storageCheck, ai] = await Promise.all([checkDb(fresh), checkStorage(), checkAi(fresh)]);
  const criticalOk = db.ok && storageCheck.ok;
  const status = !criticalOk ? 'error' : (ai.ok ? 'ok' : 'degraded');
  const httpStatus = criticalOk ? 200 : 503;
  return {
    httpStatus,
    body: { status, checks: { db, storage: storageCheck, ai }, version, commit },
  };
}

module.exports = { deepHealth };
