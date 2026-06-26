const { Router } = require('express');
const { requireAuth } = require('../../shared/middleware/auth');
const { validate } = require('../../shared/middleware/validate');
const { parsePostingSchema } = require('./postings.schema');
const ctrl = require('./postings.controller');

const router = Router();
router.use(requireAuth);

router.post('/parse', validate(parsePostingSchema), ctrl.parse);

module.exports = router;
