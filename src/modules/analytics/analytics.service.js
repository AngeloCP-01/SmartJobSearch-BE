const prisma = require('../../shared/database/prisma');
const { STATUSES } = require('../applications/applications.schema');

const MONTHS = 12;

// 12 ascending 'YYYY-MM' keys ending at the current (UTC) month.
function monthKeys(now = new Date()) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  d.setUTCMonth(d.getUTCMonth() - (MONTHS - 1));
  const keys = [];
  for (let i = 0; i < MONTHS; i += 1) {
    keys.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return keys;
}

async function overTime(userId) {
  const keys = monthKeys();
  const start = new Date(`${keys[0]}-01T00:00:00.000Z`);
  const rows = await prisma.$queryRaw`
    SELECT to_char(date_trunc('month', COALESCE("applicationDate", "createdAt")), 'YYYY-MM') AS month,
           COUNT(*)::int AS count
    FROM "Application"
    WHERE "userId" = ${userId}
      AND COALESCE("applicationDate", "createdAt") >= ${start}
    GROUP BY 1
  `;
  const counts = Object.fromEntries(rows.map((r) => [r.month, Number(r.count)]));
  return keys.map((month) => ({ month, count: counts[month] || 0 }));
}

async function analytics(userId) {
  const [total, interviewed, grouped, over] = await Promise.all([
    prisma.application.count({ where: { userId } }),
    prisma.application.count({ where: { userId, interviews: { some: {} } } }),
    prisma.application.groupBy({ by: ['status'], where: { userId }, _count: { _all: true } }),
    overTime(userId),
  ]);

  const byStatus = Object.fromEntries(grouped.map((g) => [g.status, g._count._all]));
  const rate = (n) => (total === 0 ? 0 : n / total);
  const offers = (byStatus.Offer || 0) + (byStatus.Accepted || 0);

  return {
    metrics: {
      totalApplications: total,
      interviewRate: rate(interviewed),
      offerRate: rate(offers),
      rejectionRate: rate(byStatus.Rejected || 0),
    },
    funnel: STATUSES.map((status) => ({ status, count: byStatus[status] || 0 })),
    overTime: over,
  };
}

module.exports = { analytics, monthKeys };
