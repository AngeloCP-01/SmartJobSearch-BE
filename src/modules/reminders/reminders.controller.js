const service = require('./reminders.service');

async function reminders(req, res, next) {
  try { res.json(await service.reminders(req.userId)); }
  catch (e) { next(e); }
}

module.exports = { reminders };
