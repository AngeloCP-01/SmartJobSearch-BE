const prisma = require('../../shared/database/prisma');
const { NotFoundError } = require('../../shared/utils/errors');
const activity = require('../activity/activity.service');

async function assertApplication(userId, applicationId) {
  if (applicationId === undefined) return;
  const app = await prisma.application.findFirst({ where: { id: applicationId, userId } });
  if (!app) throw new NotFoundError('Application not found');
}

async function positionOf(userId, applicationId) {
  const app = await prisma.application.findFirst({ where: { id: applicationId, userId }, select: { position: true } });
  return app?.position;
}

const list = (userId, { applicationId } = {}) =>
  prisma.interview.findMany({
    where: { userId, ...(applicationId ? { applicationId } : {}) },
    orderBy: [{ scheduledAt: 'asc' }, { createdAt: 'asc' }],
  });

async function getById(userId, id) {
  const interview = await prisma.interview.findFirst({ where: { id, userId } });
  if (!interview) throw new NotFoundError('Interview not found');
  return interview;
}

async function create(userId, data) {
  await assertApplication(userId, data.applicationId);
  const interview = await prisma.interview.create({ data: { ...data, userId } });
  await activity.record(userId, 'InterviewScheduled', {
    applicationId: interview.applicationId,
    metadata: { position: await positionOf(userId, interview.applicationId), type: interview.type, scheduledAt: interview.scheduledAt },
  });
  return interview;
}

async function update(userId, id, data) {
  const existing = await getById(userId, id);
  await assertApplication(userId, data.applicationId);
  const interview = await prisma.interview.update({ where: { id }, data });
  if (data.result && data.result !== existing.result && (data.result === 'Passed' || data.result === 'Failed')) {
    await activity.record(userId, 'InterviewResultRecorded', {
      applicationId: interview.applicationId,
      metadata: { position: await positionOf(userId, interview.applicationId), type: interview.type, result: data.result },
    });
  }
  return interview;
}

async function remove(userId, id) {
  await getById(userId, id);
  await prisma.interview.delete({ where: { id } });
}

module.exports = { list, getById, create, update, remove };
