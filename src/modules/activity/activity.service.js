const prisma = require('../../shared/database/prisma');

const selectItem = { id: true, action: true, applicationId: true, metadata: true, createdAt: true };

async function record(userId, action, { applicationId = null, metadata = {} } = {}) {
  await prisma.activityLog.create({ data: { userId, action, applicationId, metadata } });
}

// The cursor is an opaque `<createdAt ISO>|<id>` token. A compound (createdAt, id)
// cursor + tiebreaker ordering is required because many events share the same
// millisecond createdAt (e.g. an application and its ApplicationCreated log are
// written in one request); a pure-timestamp `lt` cursor would silently drop the
// tied rows at a page boundary.
function cursorFilter(before) {
  if (!before) return {};
  const [beforeTime, beforeId] = String(before).split('|');
  const dt = new Date(beforeTime);
  if (Number.isNaN(dt.getTime())) return {};
  if (!beforeId) return { createdAt: { lt: dt } };
  return { OR: [{ createdAt: { lt: dt } }, { createdAt: dt, id: { lt: beforeId } }] };
}

async function list(userId, { applicationId, limit, before } = {}) {
  const take = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 100);
  const items = await prisma.activityLog.findMany({
    where: {
      userId,
      ...(applicationId ? { applicationId } : {}),
      ...cursorFilter(before),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take,
    select: selectItem,
  });
  const last = items[items.length - 1];
  const nextCursor = items.length === take ? `${last.createdAt.toISOString()}|${last.id}` : null;
  return { items, nextCursor };
}

module.exports = { record, list };
