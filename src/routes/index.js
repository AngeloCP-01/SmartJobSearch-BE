const { Router } = require('express');
const authRoutes = require('../modules/auth/auth.routes');
const companiesRoutes = require('../modules/companies/companies.routes');
const applicationsRoutes = require('../modules/applications/applications.routes');
const interviewsRoutes = require('../modules/interviews/interviews.routes');

const router = Router();

router.get('/health', (req, res) => res.json({ status: 'ok' }));
router.use('/auth', authRoutes);
router.use('/companies', companiesRoutes);
router.use('/applications', applicationsRoutes);
router.use('/interviews', interviewsRoutes);

module.exports = router;
