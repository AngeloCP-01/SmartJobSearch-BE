const { Router } = require('express');
const { requireAuth } = require('../../shared/middleware/auth');
const { validate } = require('../../shared/middleware/validate');
const { runAnalysisSchema, coverLetterSchema } = require('./analysis.schema');
const ctrl = require('./analysis.controller');

const router = Router();
router.use(requireAuth);

router.get('/', ctrl.list);
router.post('/', validate(runAnalysisSchema), ctrl.run);
router.post('/cover-letter', validate(coverLetterSchema), ctrl.generateCoverLetter);
router.get('/config', ctrl.config);
router.get('/:id', ctrl.getById);
router.delete('/:id', ctrl.remove);

module.exports = router;
