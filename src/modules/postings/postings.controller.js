const service = require('./postings.service');

async function parse(req, res, next) {
  try { res.json(await service.parsePosting(req.userId, req.body)); }
  catch (e) { next(e); }
}

module.exports = { parse };
