const service = require('./dashboard.service');

async function summary(req, res, next) {
  try { res.json(await service.summary(req.userId)); }
  catch (e) { next(e); }
}

module.exports = { summary };
