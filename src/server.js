require('dotenv').config();
const { initSentry } = require('./shared/observability/sentry');
initSentry();

const app = require('./app');
const { logger } = require('./shared/observability/logger');

const port = process.env.PORT || 4000;
app.listen(port, () => logger.info({ port }, `API listening on :${port}`));
