const prisma = require('../../shared/database/prisma');

async function summary(userId) {
  const [totalApplications, grouped, upcomingInterviews] = await Promise.all([
    prisma.application.count({ where: { userId } }),
    prisma.application.groupBy({
      by: ['status'],
      where: { userId },
      _count: { _all: true },
    }),
    prisma.interview.findMany({
      where: { userId, scheduledAt: { gte: new Date() } },
      orderBy: { scheduledAt: 'asc' },
      take: 5,
    }),
  ]);

  const byStatus = Object.fromEntries(grouped.map((g) => [g.status, g._count._all]));
  return { totalApplications, byStatus, upcomingInterviews };
}

module.exports = { summary };
