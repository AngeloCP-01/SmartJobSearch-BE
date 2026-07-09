const { Router } = require('express');
const { requireAuth } = require('../../shared/middleware/auth');
const ctrl = require('./rag.controller');

const router = Router();
router.use(requireAuth);

router.post('/reindex', ctrl.reindex);
router.get('/search', ctrl.search);

module.exports = router;
