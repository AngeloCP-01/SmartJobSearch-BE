const service = require('./authored-documents.service');
const { logger } = require('../../shared/observability/logger');

function countImages(node) {
  if (!node || typeof node !== 'object') return 0;
  let n = node.type === 'image' ? 1 : 0;
  if (Array.isArray(node.content)) for (const c of node.content) n += countImages(c);
  return n;
}

async function list(req, res, next) {
  try { res.json(await service.list(req.userId)); }
  catch (e) { next(e); }
}
async function getById(req, res, next) {
  try {
    const doc = await service.getById(req.userId, req.params.id);
    logger.debug({ id: req.params.id, imageNodes: countImages(doc.content) }, '[editor-debug] GET saved content');
    res.json(doc);
  } catch (e) { next(e); }
}
async function create(req, res, next) {
  try { res.status(201).json(await service.create(req.userId, req.body)); }
  catch (e) { next(e); }
}
async function update(req, res, next) {
  try {
    if (req.body && Object.prototype.hasOwnProperty.call(req.body, 'content')) {
      logger.debug({ id: req.params.id, imageNodes: countImages(req.body.content), title: req.body.title }, '[editor-debug] PATCH content');
    }
    res.json(await service.update(req.userId, req.params.id, req.body));
  } catch (e) { next(e); }
}
async function remove(req, res, next) {
  try { await service.remove(req.userId, req.params.id); res.status(204).end(); }
  catch (e) { next(e); }
}

module.exports = { list, getById, create, update, remove };
