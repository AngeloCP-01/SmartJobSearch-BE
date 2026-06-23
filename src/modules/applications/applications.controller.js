const service = require('./applications.service');
const contactsService = require('../contacts/contacts.service');

async function list(req, res, next) {
  try { res.json(await service.list(req.userId, { status: req.query.status })); }
  catch (e) { next(e); }
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
async function updateStatus(req, res, next) {
  try { res.json(await service.updateStatus(req.userId, req.params.id, req.body.status)); }
  catch (e) { next(e); }
}
async function remove(req, res, next) {
  try { await service.remove(req.userId, req.params.id); res.status(204).end(); }
  catch (e) { next(e); }
}
async function linkContact(req, res, next) {
  try {
    res.status(201).json(await contactsService.linkApplication(req.userId, req.params.id, req.body.contactId));
  } catch (e) { next(e); }
}
async function unlinkContact(req, res, next) {
  try {
    await contactsService.unlinkApplication(req.userId, req.params.id, req.params.contactId);
    res.status(204).end();
  } catch (e) { next(e); }
}

module.exports = { list, getById, create, update, updateStatus, remove, linkContact, unlinkContact };
