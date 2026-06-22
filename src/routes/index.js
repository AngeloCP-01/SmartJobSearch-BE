const { Router } = require('express');
const authRoutes = require('../modules/auth/auth.routes');
const companiesRoutes = require('../modules/companies/companies.routes');

const router = Router();

router.get('/health', (req, res) => res.json({ status: 'ok' }));
router.use('/auth', authRoutes);
router.use('/companies', companiesRoutes);

module.exports = router;
