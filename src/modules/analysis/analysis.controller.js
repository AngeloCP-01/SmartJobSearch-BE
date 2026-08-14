const service = require('./analysis.service');
const { toSkipTake, toOffsetEnvelope } = require('../../shared/pagination');

async function run(req, res, next) {
  try { res.status(201).json(await service.run(req.userId, req.body)); }
  catch (e) { next(e); }
}
async function generateCoverLetter(req, res, next) {
  try { res.status(201).json(await service.generateCoverLetter(req.userId, req.body)); }
  catch (e) { next(e); }
}
async function tailor(req, res, next) {
  try { res.status(201).json(await service.generateTailoringSuggestions(req.userId, req.body)); }
  catch (e) { next(e); }
}
async function list(req, res, next) {
  try {
    const { items } = await service.list(req.userId, {});
    res.json(items);
  } catch (e) { next(e); }
}

// v2: same service call, wrapped in the offset envelope. Query params have
// already been validated and coerced by validate(schema, 'query').
async function listPaged(req, res, next) {
  try {
    const {
      page, pageSize, sort, dir,
    } = req.query;
    const { skip, take } = toSkipTake({ page, pageSize });
    const { items, total } = await service.list(req.userId, {
      sort, dir, skip, take,
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
async function remove(req, res, next) {
  try { await service.remove(req.userId, req.params.id); res.status(204).end(); }
  catch (e) { next(e); }
}
async function config(req, res, next) {
  try { res.json(await service.config()); }
  catch (e) { next(e); }
}

module.exports = {
  list, listPaged, run, generateCoverLetter, tailor, getById, remove, config,
};
