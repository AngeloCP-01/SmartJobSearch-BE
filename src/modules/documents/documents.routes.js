const { Router } = require('express');
const { requireAuth } = require('../../shared/middleware/auth');
const { validate } = require('../../shared/middleware/validate');
const { createDocumentSchema } = require('./documents.schema');
const { uploadSingle } = require('./documents.upload');
const ctrl = require('./documents.controller');

const router = Router();
router.use(requireAuth);

router.get('/', ctrl.list);
router.post('/', uploadSingle, validate(createDocumentSchema), ctrl.create);

module.exports = router;
