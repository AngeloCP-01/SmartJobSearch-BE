const { Router } = require('express');
const { requireAuth } = require('../../shared/middleware/auth');
const { validate } = require('../../shared/middleware/validate');
const {
  createCompanySchema, updateCompanySchema, listCompaniesQuerySchema,
} = require('./companies.schema');
const ctrl = require('./companies.controller');

// One route table, two list handlers — see applications.routes.js.
function makeRouter(listHandler) {
  const router = Router();
  router.use(requireAuth);

  router.get('/', listHandler);
  router.post('/', validate(createCompanySchema), ctrl.create);
  router.get('/:id', ctrl.getById);
  router.patch('/:id', validate(updateCompanySchema), ctrl.update);
  router.delete('/:id', ctrl.remove);

  return router;
}

module.exports = {
  v1: makeRouter(ctrl.list),
  v2: makeRouter([validate(listCompaniesQuerySchema, 'query'), ctrl.listPaged]),
};
