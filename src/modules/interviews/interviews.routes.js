const { Router } = require('express');
const { requireAuth } = require('../../shared/middleware/auth');
const { validate } = require('../../shared/middleware/validate');
const { createInterviewSchema, updateInterviewSchema } = require('./interviews.schema');
const ctrl = require('./interviews.controller');

const router = Router();
router.use(requireAuth);

router.get('/', ctrl.list);
router.post('/', validate(createInterviewSchema), ctrl.create);
router.get('/:id', ctrl.getById);
router.patch('/:id', validate(updateInterviewSchema), ctrl.update);
router.delete('/:id', ctrl.remove);

module.exports = router;
