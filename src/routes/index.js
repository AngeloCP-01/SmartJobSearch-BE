const { Router } = require('express');
const authRoutes = require('../modules/auth/auth.routes');
const companiesRoutes = require('../modules/companies/companies.routes');
const applicationsRoutes = require('../modules/applications/applications.routes');
const interviewsRoutes = require('../modules/interviews/interviews.routes');
const contactsRoutes = require('../modules/contacts/contacts.routes');
const dashboardRoutes = require('../modules/dashboard/dashboard.routes');
const analyticsRoutes = require('../modules/analytics/analytics.routes');
const remindersRoutes = require('../modules/reminders/reminders.routes');
const documentsRoutes = require('../modules/documents/documents.routes');
const activityRoutes = require('../modules/activity/activity.routes');
const analysisRoutes = require('../modules/analysis/analysis.routes');
const postingsRoutes = require('../modules/postings/postings.routes');

const router = Router();

router.get('/health', (req, res) => res.json({ status: 'ok' }));
router.use('/auth', authRoutes);
router.use('/companies', companiesRoutes);
router.use('/contacts', contactsRoutes);
router.use('/applications', applicationsRoutes);
router.use('/interviews', interviewsRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/analytics', analyticsRoutes);
router.use('/reminders', remindersRoutes);
router.use('/documents', documentsRoutes);
router.use('/activity', activityRoutes);
router.use('/analysis', analysisRoutes);
router.use('/postings', postingsRoutes);

module.exports = router;
