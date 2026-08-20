const { Router } = require('express');
const { deepHealth } = require('./health.service');

const router = Router();

// Dependency-aware readiness check. Status code encodes severity: 503 when a
// critical dep (db/storage) is down (uptime monitor pages), 200 otherwise —
// including AI-degraded, which is visible but non-paging.
//
// The db/ai probes are throttled (see health.service.js) so this stays cheap to
// poll — a live `SELECT 1` wakes Neon and restarts its scale-to-zero timer.
// `?fresh=1` forces live probes for on-demand diagnostics; do NOT point a
// recurring monitor at it. For uptime checks use the DB-free GET /api/health.
router.get('/health/deep', async (req, res, next) => {
  try {
    const fresh = req.query.fresh === '1' || req.query.fresh === 'true';
    const { httpStatus, body } = await deepHealth({ fresh });
    res.status(httpStatus).json(body);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
