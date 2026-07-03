const { Router } = require('express');
const { requireAuth } = require('../../shared/middleware/auth');
const { validate } = require('../../shared/middleware/validate');
const { createDocumentSchema, updateDocumentSchema } = require('./documents.schema');
const { uploadSingle } = require('./documents.upload');
const ctrl = require('./documents.controller');

const router = Router();
router.use(requireAuth);

router.get('/', ctrl.list);
router.post('/', uploadSingle, validate(createDocumentSchema), ctrl.create);
router.get('/:id/file', ctrl.download);
router.get('/:id/text', ctrl.getText);
router.patch('/:id', validate(updateDocumentSchema), ctrl.update);
router.delete('/:id', ctrl.remove);

module.exports = router;
