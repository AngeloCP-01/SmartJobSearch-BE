const { Router } = require('express');
const { requireAuth } = require('../../shared/middleware/auth');
const ctrl = require('./analytics.controller');

const router = Router();
router.use(requireAuth);

router.get('/', ctrl.analytics);

module.exports = router;
