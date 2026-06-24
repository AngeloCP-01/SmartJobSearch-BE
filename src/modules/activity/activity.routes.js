const { Router } = require('express');
const { requireAuth } = require('../../shared/middleware/auth');
const ctrl = require('./activity.controller');

const router = Router();
router.use(requireAuth);

router.get('/', ctrl.list);

module.exports = router;
