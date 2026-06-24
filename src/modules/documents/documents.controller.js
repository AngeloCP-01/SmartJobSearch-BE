const service = require('./documents.service');
const storage = require('../../shared/storage');
const { ValidationError } = require('../../shared/utils/errors');

async function create(req, res, next) {
  try {
    if (!req.file) throw new ValidationError('File is required', [{ path: 'file', message: 'A file is required' }]);
    res.status(201).json(await service.create(req.userId, req.body, req.file));
  } catch (e) { next(e); }
}

async function list(req, res, next) {
  try { res.json(await service.list(req.userId, { search: req.query.search, type: req.query.type })); }
  catch (e) { next(e); }
}

async function download(req, res, next) {
  try {
    const meta = await service.getForDownload(req.userId, req.params.id);
    res.setHeader('Content-Type', meta.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${meta.originalFilename.replace(/"/g, '')}"`);
    storage.createReadStream(meta.storageKey).on('error', next).pipe(res);
  } catch (e) { next(e); }
}

async function update(req, res, next) {
  try { res.json(await service.update(req.userId, req.params.id, req.body)); }
  catch (e) { next(e); }
}

async function remove(req, res, next) {
  try { await service.remove(req.userId, req.params.id); res.status(204).end(); }
  catch (e) { next(e); }
}

module.exports = { create, list, download, update, remove };
