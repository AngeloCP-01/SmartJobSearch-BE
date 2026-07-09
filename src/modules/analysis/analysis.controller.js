const service = require('./analysis.service');

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
  try { res.json(await service.list(req.userId)); }
  catch (e) { next(e); }
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

module.exports = { run, generateCoverLetter, tailor, list, getById, remove, config };
