const prisma = require('../../shared/database/prisma');

const selectItem = { id: true, action: true, applicationId: true, metadata: true, createdAt: true };

async function record(userId, action, { applicationId = null, metadata = {} } = {}) {
  await prisma.activityLog.create({ data: { userId, action, applicationId, metadata } });
}

async function list(userId, { applicationId, limit, before } = {}) {
  const take = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 100);
  const items = await prisma.activityLog.findMany({
    where: {
      userId,
      ...(applicationId ? { applicationId } : {}),
      ...(before ? { createdAt: { lt: new Date(before) } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take,
    select: selectItem,
  });
  const nextCursor = items.length === take ? items[items.length - 1].createdAt.toISOString() : null;
  return { items, nextCursor };
}

module.exports = { record, list };
