require('dotenv').config({ path: '.env.test' });

// Point this worker's Prisma client at its own schema (provisioned in
// globalSetup.js). This must run before the app's Prisma singleton is
// constructed — it is, because Jest runs setupFiles before loading test
// modules, and the singleton reads DATABASE_URL at construction time.
const { schemaUrl, workerSchema } = require('./dbUrl');
process.env.DATABASE_URL = schemaUrl(process.env.DATABASE_URL, workerSchema());
