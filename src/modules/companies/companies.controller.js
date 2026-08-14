const service = require('./companies.service');
const { toSkipTake, toOffsetEnvelope } = require('../../shared/pagination');

async function list(req, res, next) {
  try {
    const { items } = await service.list(req.userId, { search: req.query.search });
    res.json(items);
  } catch (e) { next(e); }
}

// v2: same service call, wrapped in the offset envelope. Query params have
// already been validated and coerced by validate(schema, 'query').
async function listPaged(req, res, next) {
  try {
    const {
      page, pageSize, sort, dir, search,
    } = req.query;
    const { skip, take } = toSkipTake({ page, pageSize });
    const { items, total } = await service.list(req.userId, {
      search, sort, dir, skip, take,
    });
    res.json(toOffsetEnvelope({
      items, total, page, pageSize,
    }));
  } catch (e) { next(e); }
}
async function getById(req, res, next) {
  try { res.json(await service.getById(req.userId, req.params.id)); }
  catch (e) { next(e); }
}
async function create(req, res, next) {
  try { res.status(201).json(await service.create(req.userId, req.body)); }
  catch (e) { next(e); }
}
async function update(req, res, next) {
  try { res.json(await service.update(req.userId, req.params.id, req.body)); }
  catch (e) { next(e); }
}
async function remove(req, res, next) {
  try { await service.remove(req.userId, req.params.id); res.status(204).end(); }
  catch (e) { next(e); }
}

module.exports = {
  list, listPaged, getById, create, update, remove,
};
