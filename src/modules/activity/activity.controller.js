const service = require('./activity.service');
const { toCursorEnvelope } = require('../../shared/pagination');

async function list(req, res, next) {
  try {
    res.json(await service.list(req.userId, {
      applicationId: req.query.applicationId,
      limit: req.query.limit,
      before: req.query.before,
    }));
  } catch (e) { next(e); }
}

// v2: cursor envelope. Query params have already been validated and coerced
// by validate(schema, 'query').
async function listPaged(req, res, next) {
  try {
    const { pageSize, before, applicationId } = req.query;
    const { items, nextCursor } = await service.list(req.userId, {
      applicationId, before, pageSize,
    });
    res.json(toCursorEnvelope({ items, pageSize, nextCursor }));
  } catch (e) { next(e); }
}

module.exports = { list, listPaged };
