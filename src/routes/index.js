const { Router } = require('express');
const authRoutes = require('../modules/auth/auth.routes');
const companiesRoutes = require('../modules/companies/companies.routes');
const applicationsRoutes = require('../modules/applications/applications.routes');
const interviewsRoutes = require('../modules/interviews/interviews.routes');
const contactsRoutes = require('../modules/contacts/contacts.routes');
const dashboardRoutes = require('../modules/dashboard/dashboard.routes');

const router = Router();

router.get('/health', (req, res) => res.json({ status: 'ok' }));
router.use('/auth', authRoutes);
router.use('/companies', companiesRoutes);
router.use('/contacts', contactsRoutes);
router.use('/applications', applicationsRoutes);
router.use('/interviews', interviewsRoutes);
router.use('/dashboard', dashboardRoutes);

module.exports = router;
