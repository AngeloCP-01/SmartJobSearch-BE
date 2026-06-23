const { Router } = require('express');
const { requireAuth } = require('../../shared/middleware/auth');
const ctrl = require('./reminders.controller');

const router = Router();
router.use(requireAuth);

router.get('/', ctrl.reminders);

module.exports = router;
