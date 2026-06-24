const service = require('./documents.service');
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

module.exports = { create, list };
