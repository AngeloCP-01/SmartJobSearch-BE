const { Router } = require('express');
const { requireAuth } = require('../../shared/middleware/auth');
const { validate } = require('../../shared/middleware/validate');
const {
  createContactSchema, updateContactSchema, listContactsQuerySchema,
} = require('./contacts.schema');
const ctrl = require('./contacts.controller');

// One route table, two list handlers — see applications.routes.js.
function makeRouter(listHandler) {
  const router = Router();
  router.use(requireAuth);

  router.get('/', listHandler);
  router.post('/', validate(createContactSchema), ctrl.create);
  router.get('/:id', ctrl.getById);
  router.patch('/:id', validate(updateContactSchema), ctrl.update);
  router.delete('/:id', ctrl.remove);

  return router;
}

module.exports = {
  v1: makeRouter(ctrl.list),
  v2: makeRouter([validate(listContactsQuerySchema, 'query'), ctrl.listPaged]),
};
