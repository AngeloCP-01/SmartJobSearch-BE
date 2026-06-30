const service = require('./images.service');
const storage = require('../../shared/storage');
const { ValidationError } = require('../../shared/utils/errors');

function imageUrl(req, id) {
  const base = (process.env.PUBLIC_API_URL || `${req.protocol}://${req.get('host')}/api`).replace(/\/$/, '');
  return `${base}/images/${id}`;
}

async function create(req, res, next) {
  try {
    if (!req.file) throw new ValidationError('No file uploaded');
    const image = await service.create(req.userId, req.file);
    res.status(201).json({ id: image.id, url: imageUrl(req, image.id) });
  } catch (e) { next(e); }
}

async function serve(req, res, next) {
  try {
    const image = await service.getForServe(req.params.id);
    const stream = storage.createReadStream(image.storageKey);
    stream.on('open', () => {
      res.setHeader('Content-Type', image.mimeType);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    });
    stream.on('error', (err) => {
      if (res.headersSent) return res.destroy(err);
      return next(err);
    });
    stream.pipe(res);
  } catch (e) { next(e); }
}

module.exports = { create, serve };
