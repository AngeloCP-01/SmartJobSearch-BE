const service = require('./authored-documents.service');

// --- temporary editor-image debug logging (dev only) ---
const DBG = process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test';
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
    if (DBG) console.log(`[editor-debug] GET ${req.params.id} — saved content image nodes: ${countImages(doc.content)}`);
    res.json(doc);
  } catch (e) { next(e); }
}
async function create(req, res, next) {
  try { res.status(201).json(await service.create(req.userId, req.body)); }
  catch (e) { next(e); }
}
async function update(req, res, next) {
  try {
    if (DBG && req.body && Object.prototype.hasOwnProperty.call(req.body, 'content')) {
      console.log(`[editor-debug] PATCH ${req.params.id} — content image nodes: ${countImages(req.body.content)} | title: ${JSON.stringify(req.body.title)}`);
    }
    res.json(await service.update(req.userId, req.params.id, req.body));
  } catch (e) { next(e); }
}
async function remove(req, res, next) {
  try { await service.remove(req.userId, req.params.id); res.status(204).end(); }
  catch (e) { next(e); }
}

module.exports = { list, getById, create, update, remove };
