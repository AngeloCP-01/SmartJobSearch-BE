const { Router } = require('express');
const { requireAuth } = require('../../shared/middleware/auth');
const uploadSingle = require('./images.upload');
const ctrl = require('./images.controller');

const router = Router();

// Public, unauthenticated image serving (this is the <img src> URL).
router.get('/:id', ctrl.serve);

// Authenticated upload.
router.post('/', requireAuth, uploadSingle, ctrl.create);

module.exports = router;
