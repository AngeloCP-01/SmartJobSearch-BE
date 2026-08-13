const { Router } = require('express');
const { requireAuth } = require('../../shared/middleware/auth');
const { validate } = require('../../shared/middleware/validate');
const {
  createApplicationSchema, updateApplicationSchema, statusSchema, listApplicationsQuerySchema,
} = require('./applications.schema');
const { linkContactSchema } = require('../contacts/contacts.schema');
const { linkDocumentSchema } = require('../documents/documents.schema');
const ctrl = require('./applications.controller');

// One route table, two list handlers. Duplicating the table for v2 instead
// would let the versions drift the first time either is edited.
function makeRouter(listHandler) {
  const router = Router();
  router.use(requireAuth);

  router.get('/', listHandler);
  router.post('/', validate(createApplicationSchema), ctrl.create);
  router.get('/:id', ctrl.getById);
  router.patch('/:id', validate(updateApplicationSchema), ctrl.update);
  router.patch('/:id/status', validate(statusSchema), ctrl.updateStatus);
  router.delete('/:id', ctrl.remove);
  router.post('/:id/contacts', validate(linkContactSchema), ctrl.linkContact);
  router.delete('/:id/contacts/:contactId', ctrl.unlinkContact);
  router.post('/:id/documents', validate(linkDocumentSchema), ctrl.linkDocument);
  router.delete('/:id/documents/:documentId', ctrl.unlinkDocument);

  return router;
}

module.exports = {
  v1: makeRouter(ctrl.list),
  v2: makeRouter([validate(listApplicationsQuerySchema, 'query'), ctrl.listPaged]),
};
