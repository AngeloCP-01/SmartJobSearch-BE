const service = require('./analytics.service');

async function analytics(req, res, next) {
  try { res.json(await service.analytics(req.userId)); }
  catch (e) { next(e); }
}

module.exports = { analytics };
