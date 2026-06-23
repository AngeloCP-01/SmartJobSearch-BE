const prisma = require('../../shared/database/prisma');

const WINDOW_DAYS = 7;

const interviewInclude = {
  application: {
    select: { id: true, position: true, company: { select: { id: true, name: true } } },
  },
};
const companyInclude = { company: { select: { id: true, name: true } } };

const shapeInterview = (i) => ({
  id: i.id, type: i.type, scheduledAt: i.scheduledAt, result: i.result, application: i.application,
});
const shapeFollowUp = (c) => ({
  id: c.id, name: c.name, position: c.position, followUpDate: c.followUpDate, company: c.company,
});

async function reminders(userId) {
  void prisma; void WINDOW_DAYS; void interviewInclude; void companyInclude;
  void shapeInterview; void shapeFollowUp; void userId;
  const interviews = { upcoming: [], overdue: [] };
  const followUps = { due: [], upcoming: [] };
  return {
    interviews,
    followUps,
    counts: { total: 0, interviews: 0, followUps: 0 },
  };
}

module.exports = { reminders };
