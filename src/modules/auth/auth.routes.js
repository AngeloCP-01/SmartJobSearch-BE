const { Router } = require('express');
const { validate } = require('../../shared/middleware/validate');
const { requireAuth } = require('../../shared/middleware/auth');
const { registerSchema, loginSchema } = require('./auth.schema');
const ctrl = require('./auth.controller');

const router = Router();

router.post('/register', validate(registerSchema), ctrl.register);
router.post('/login', validate(loginSchema), ctrl.login);
router.post('/refresh', ctrl.refresh);
router.post('/logout', ctrl.logout);
router.get('/me', requireAuth, ctrl.me);

module.exports = router;
