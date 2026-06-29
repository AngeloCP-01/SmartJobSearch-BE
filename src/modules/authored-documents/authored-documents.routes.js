const { Router } = require('express');
const { requireAuth } = require('../../shared/middleware/auth');
const { validate } = require('../../shared/middleware/validate');
const { createAuthoredDocumentSchema, updateAuthoredDocumentSchema } = require('./authored-documents.schema');
const ctrl = require('./authored-documents.controller');

const router = Router();
router.use(requireAuth);

router.get('/', ctrl.list);
router.post('/', validate(createAuthoredDocumentSchema), ctrl.create);
router.get('/:id', ctrl.getById);
router.patch('/:id', validate(updateAuthoredDocumentSchema), ctrl.update);
router.delete('/:id', ctrl.remove);

module.exports = router;
