require('dotenv').config();
// LOAD-BEARING ORDER: initSentry() must run before the first require('pino')
// (pulled in below via ./app -> logger.js) so Sentry.pinoIntegration()'s
// require-in-the-middle hook is installed in time to capture pino logs.
const { initSentry } = require('./shared/observability/sentry');
initSentry();

const app = require('./app');
const { logger } = require('./shared/observability/logger');

const port = process.env.PORT || 4000;
app.listen(port, () => logger.info({ port }, `API listening on :${port}`));
