const prisma = require('../../shared/database/prisma');
const { NotFoundError } = require('../../shared/utils/errors');

async function assertApplication(userId, applicationId) {
  if (applicationId === undefined) return;
  const app = await prisma.application.findFirst({ where: { id: applicationId, userId } });
  if (!app) throw new NotFoundError('Application not found');
}

const list = (userId, { applicationId } = {}) =>
  prisma.interview.findMany({
    where: { userId, ...(applicationId ? { applicationId } : {}) },
    orderBy: { scheduledAt: 'asc' },
  });

async function getById(userId, id) {
  const interview = await prisma.interview.findFirst({ where: { id, userId } });
  if (!interview) throw new NotFoundError('Interview not found');
  return interview;
}

async function create(userId, data) {
  await assertApplication(userId, data.applicationId);
  return prisma.interview.create({ data: { ...data, userId } });
}

async function update(userId, id, data) {
  await getById(userId, id);
  await assertApplication(userId, data.applicationId);
  return prisma.interview.update({ where: { id }, data });
}

async function remove(userId, id) {
  await getById(userId, id);
  await prisma.interview.delete({ where: { id } });
}

module.exports = { list, getById, create, update, remove };
