const service = require('./rag.service');

async function reindex(req, res, next) {
  try { res.status(200).json(await service.reindexAll(req.userId)); } catch (e) { next(e); }
}

async function search(req, res, next) {
  try {
    const q = String(req.query.q || '').trim();
    if (!q) return res.status(400).json({ error: 'q is required' });
    const topK = Math.min(20, Math.max(1, Number(req.query.topK) || 6));
    const hits = await service.retrieve(req.userId, q, { topK });
    return res.status(200).json({ hits });
  } catch (e) { return next(e); }
}

module.exports = { reindex, search };
