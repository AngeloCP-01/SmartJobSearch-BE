const multer = require('multer');
const { ValidationError } = require('../../shared/utils/errors');

const ALLOWED = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const MAX_BYTES = 5 * 1024 * 1024;

const handler = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES },
  fileFilter: (req, file, cb) => {
    if (ALLOWED.has(file.mimetype)) return cb(null, true);
    return cb(new ValidationError('Unsupported image type', []));
  },
}).single('file');

// Convert multer's errors (size limit, fileFilter) into our ValidationError (400).
function uploadSingle(req, res, next) {
  handler(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') return next(new ValidationError('Image too large (max 5MB)'));
    if (err.status) return next(err); // already an AppError (e.g. fileFilter ValidationError)
    return next(new ValidationError(err.message || 'Upload failed'));
  });
}

module.exports = uploadSingle;
