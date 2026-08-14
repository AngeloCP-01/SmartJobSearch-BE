const { Router } = require('express');
const { requireAuth } = require('../../shared/middleware/auth');
const { validate } = require('../../shared/middleware/validate');
const { listActivityQuerySchema } = require('./activity.schema');
const ctrl = require('./activity.controller');

// One route table, two list handlers — see applications.routes.js.
function makeRouter(listHandler) {
  const router = Router();
  router.use(requireAuth);

  router.get('/', listHandler);

  return router;
}

module.exports = {
  v1: makeRouter(ctrl.list),
  v2: makeRouter([validate(listActivityQuerySchema, 'query'), ctrl.listPaged]),
};
