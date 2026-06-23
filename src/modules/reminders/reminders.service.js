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
  const now = new Date();
  const windowEnd = new Date(now.getTime() + WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const [upcomingI, overdueI, dueF, upcomingF] = await Promise.all([
    prisma.interview.findMany({
      where: { userId, scheduledAt: { gte: now, lte: windowEnd } },
      orderBy: { scheduledAt: 'asc' },
      include: interviewInclude,
    }),
    prisma.interview.findMany({
      where: { userId, scheduledAt: { lt: now }, OR: [{ result: null }, { result: 'Pending' }] },
      orderBy: { scheduledAt: 'desc' },
      include: interviewInclude,
    }),
    prisma.contact.findMany({
      where: { userId, followUpDate: { lte: now } },
      orderBy: { followUpDate: 'asc' },
      include: companyInclude,
    }),
    prisma.contact.findMany({
      where: { userId, followUpDate: { gt: now, lte: windowEnd } },
      orderBy: { followUpDate: 'asc' },
      include: companyInclude,
    }),
  ]);

  const interviews = { upcoming: upcomingI.map(shapeInterview), overdue: overdueI.map(shapeInterview) };
  const followUps = { due: dueF.map(shapeFollowUp), upcoming: upcomingF.map(shapeFollowUp) };
  const counts = {
    interviews: interviews.upcoming.length + interviews.overdue.length,
    followUps: followUps.due.length + followUps.upcoming.length,
    total: 0,
  };
  counts.total = counts.interviews + counts.followUps;

  return { interviews, followUps, counts };
}

module.exports = { reminders };
