// Storage abstraction. Every upload/download/delete in the app goes through the
// { save, createReadStream, remove } interface — swap the backing store with
// STORAGE_DRIVER without touching any caller (documents + analysis modules).
//
//   STORAGE_DRIVER=local  (default) → local disk under UPLOAD_DIR
//   STORAGE_DRIVER=s3              → S3-compatible object storage (see drivers/s3.js)
//
// The chosen driver is required lazily so the AWS SDK is only loaded when s3 is
// actually selected (keeps dev/test installs and startup light).
const driver = (process.env.STORAGE_DRIVER || 'local').toLowerCase() === 's3'
  ? require('./drivers/s3')
  : require('./drivers/local');

module.exports = driver;
