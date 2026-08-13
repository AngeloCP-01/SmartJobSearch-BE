const { Router } = require('express');
const applicationsRoutes = require('../modules/applications/applications.routes');
const v1Routes = require('./index');

// v2 is a COMPLETE surface: everything v1 serves, with paginated list handlers
// swapped in. Mounting v1Routes last means any module not yet migrated still
// answers under /api/v2 unchanged, so a client migrates by changing one base
// URL rather than routing per-endpoint.
const router = Router();

router.use('/applications', applicationsRoutes.v2);

router.use('/', v1Routes);

module.exports = router;
