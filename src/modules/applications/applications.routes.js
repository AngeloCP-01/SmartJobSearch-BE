const { Router } = require('express');
const { requireAuth } = require('../../shared/middleware/auth');
const { validate } = require('../../shared/middleware/validate');
const {
  createApplicationSchema, updateApplicationSchema, statusSchema,
} = require('./applications.schema');
const ctrl = require('./applications.controller');

const router = Router();
router.use(requireAuth);

router.get('/', ctrl.list);
router.post('/', validate(createApplicationSchema), ctrl.create);
router.get('/:id', ctrl.getById);
router.patch('/:id', validate(updateApplicationSchema), ctrl.update);
router.patch('/:id/status', validate(statusSchema), ctrl.updateStatus);
router.delete('/:id', ctrl.remove);

module.exports = router;
