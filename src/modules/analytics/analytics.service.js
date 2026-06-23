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

async function analytics(userId) {
  const total = await prisma.application.count({ where: { userId } });
  return {
    metrics: { totalApplications: total, interviewRate: 0, offerRate: 0, rejectionRate: 0 },
    funnel: STATUSES.map((status) => ({ status, count: 0 })),
    overTime: monthKeys().map((month) => ({ month, count: 0 })),
  };
}

module.exports = { analytics, monthKeys };
