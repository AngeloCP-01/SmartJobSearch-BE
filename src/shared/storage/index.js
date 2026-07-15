// Storage abstraction. Every upload/download/delete in the app goes through the
// { save, createReadStream, remove } interface — swap the backing store with
// STORAGE_DRIVER without touching any caller (documents + analysis modules).
//
//   STORAGE_DRIVER=local  (default) → local disk under UPLOAD_DIR
//   STORAGE_DRIVER=s3              → S3-compatible object storage (see drivers/s3.js)
//
// The chosen driver is required lazily so the AWS SDK is only loaded when s3 is
// actually selected (keeps dev/test installs and startup light).
const { AppError } = require('../utils/errors');
const { logger } = require('../observability/logger');

const driver = (process.env.STORAGE_DRIVER || 'local').toLowerCase() === 's3'
  ? require('./drivers/s3')
  : require('./drivers/local');

// Read a stored object fully into one Buffer. A read failure — the object store
// being paused/down (e.g. a free-tier project that auto-paused), a network
// error, or a missing object — is surfaced as a friendly 503 AppError instead
// of the raw driver error, so every caller (analysis, tailor, cover letter,
// RAG indexing, doc-open-in-editor) returns an honest "storage temporarily
// unavailable" rather than a generic 500 "Internal server error".
function readBuffer(key) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    driver.createReadStream(key)
      .on('data', (c) => chunks.push(c))
      .on('end', () => resolve(Buffer.concat(chunks)))
      .on('error', (err) => {
        logger.error({ err, key }, `[storage] read failed for ${key}`);
        reject(new AppError('The document store is temporarily unavailable. Please try again in a moment.', 503, 'STORAGE_UNAVAILABLE'));
      });
  });
}

module.exports = Object.assign({}, driver, { readBuffer });
