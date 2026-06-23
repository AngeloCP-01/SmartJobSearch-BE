const { Router } = require('express');
const { requireAuth } = require('../../shared/middleware/auth');
const { validate } = require('../../shared/middleware/validate');
const { createCompanySchema, updateCompanySchema } = require('./companies.schema');
const ctrl = require('./companies.controller');

const router = Router();
router.use(requireAuth);

router.get('/', ctrl.list);
router.post('/', validate(createCompanySchema), ctrl.create);
router.get('/:id', ctrl.getById);
router.patch('/:id', validate(updateCompanySchema), ctrl.update);
router.delete('/:id', ctrl.remove);

module.exports = router;
