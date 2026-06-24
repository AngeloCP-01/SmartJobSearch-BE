const { Router } = require('express');
const { requireAuth } = require('../../shared/middleware/auth');
const { validate } = require('../../shared/middleware/validate');
const {
  createApplicationSchema, updateApplicationSchema, statusSchema,
} = require('./applications.schema');
const { linkContactSchema } = require('../contacts/contacts.schema');
const { linkDocumentSchema } = require('../documents/documents.schema');
const ctrl = require('./applications.controller');

const router = Router();
router.use(requireAuth);

router.get('/', ctrl.list);
router.post('/', validate(createApplicationSchema), ctrl.create);
router.get('/:id', ctrl.getById);
router.patch('/:id', validate(updateApplicationSchema), ctrl.update);
router.patch('/:id/status', validate(statusSchema), ctrl.updateStatus);
router.delete('/:id', ctrl.remove);
router.post('/:id/contacts', validate(linkContactSchema), ctrl.linkContact);
router.delete('/:id/contacts/:contactId', ctrl.unlinkContact);
router.post('/:id/documents', validate(linkDocumentSchema), ctrl.linkDocument);
router.delete('/:id/documents/:documentId', ctrl.unlinkDocument);

module.exports = router;
