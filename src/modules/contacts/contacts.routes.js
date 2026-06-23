const { Router } = require('express');
const { requireAuth } = require('../../shared/middleware/auth');
const { validate } = require('../../shared/middleware/validate');
const { createContactSchema, updateContactSchema } = require('./contacts.schema');
const ctrl = require('./contacts.controller');

const router = Router();
router.use(requireAuth);

router.get('/', ctrl.list);
router.post('/', validate(createContactSchema), ctrl.create);
router.get('/:id', ctrl.getById);
router.patch('/:id', validate(updateContactSchema), ctrl.update);
router.delete('/:id', ctrl.remove);

module.exports = router;
