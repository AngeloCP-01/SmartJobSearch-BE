const multer = require('multer');
const { ValidationError } = require('../../shared/utils/errors');

const ALLOWED = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain', // e.g. an AI-generated cover letter saved from the app
]);
const MAX_BYTES = 5 * 1024 * 1024;

const handler = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES },
  fileFilter: (req, file, cb) => {
    if (ALLOWED.has(file.mimetype)) return cb(null, true);
    return cb(new ValidationError('Unsupported file type', [{ path: 'file', message: 'Only PDF, DOC, DOCX, or TXT files are allowed' }]));
  },
}).single('file');

function uploadSingle(req, res, next) {
  handler(req, res, (err) => {
    if (!err) return next();
    if (err instanceof ValidationError) return next(err);
    if (err.code === 'LIMIT_FILE_SIZE') {
      return next(new ValidationError('File too large', [{ path: 'file', message: 'Maximum size is 5MB' }]));
    }
    return next(new ValidationError('Upload failed', [{ path: 'file', message: err.message }]));
  });
}

module.exports = { uploadSingle };
