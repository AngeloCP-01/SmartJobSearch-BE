const { Router } = require('express');
const { requireAuth } = require('../../shared/middleware/auth');
const { validate } = require('../../shared/middleware/validate');
const {
  runAnalysisSchema, coverLetterSchema, tailorSchema, listAnalysisQuerySchema,
} = require('./analysis.schema');
const ctrl = require('./analysis.controller');

// One route table, two list handlers — see applications.routes.js.
function makeRouter(listHandler) {
  const router = Router();
  router.use(requireAuth);

  router.get('/', listHandler);
  router.post('/', validate(runAnalysisSchema), ctrl.run);
  router.post('/cover-letter', validate(coverLetterSchema), ctrl.generateCoverLetter);
  router.post('/tailor', validate(tailorSchema), ctrl.tailor);
  // '/config' must stay above '/:id' or it is swallowed as an id.
  router.get('/config', ctrl.config);
  router.get('/:id', ctrl.getById);
  router.delete('/:id', ctrl.remove);

  return router;
}

module.exports = {
  v1: makeRouter(ctrl.list),
  v2: makeRouter([validate(listAnalysisQuerySchema, 'query'), ctrl.listPaged]),
};
