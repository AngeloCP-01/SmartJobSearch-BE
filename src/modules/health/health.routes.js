const { Router } = require('express');
const { deepHealth } = require('./health.service');

const router = Router();

// Dependency-aware readiness check. Status code encodes severity: 503 when a
// critical dep (db/storage) is down (uptime monitor pages), 200 otherwise —
// including AI-degraded, which is visible but non-paging.
router.get('/health/deep', async (req, res, next) => {
  try {
    const { httpStatus, body } = await deepHealth();
    res.status(httpStatus).json(body);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
