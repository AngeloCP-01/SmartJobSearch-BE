const express = require('express');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const routes = require('./routes');
const { errorHandler } = require('./shared/middleware/error');

const app = express();

// Behind a hosting proxy (Render/Fly/etc.) that terminates TLS — needed so
// req.protocol/req.secure are correct and Secure cookies behave as expected.
if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);

app.use(cors({ origin: process.env.CORS_ORIGIN || true, credentials: true }));
app.use(express.json());
app.use(cookieParser());
app.use('/api', routes);
app.use(errorHandler);

module.exports = app;
