const service = require('./activity.service');

async function list(req, res, next) {
  try {
    res.json(await service.list(req.userId, {
      applicationId: req.query.applicationId,
      limit: req.query.limit,
      before: req.query.before,
    }));
  } catch (e) { next(e); }
}

module.exports = { list };
