const prisma = require('../../shared/database/prisma');
const { NotFoundError } = require('../../shared/utils/errors');

async function assertCompany(userId, companyId) {
  if (companyId === undefined) return;
  const company = await prisma.company.findFirst({ where: { id: companyId, userId } });
  if (!company) throw new NotFoundError('Company not found');
}

const list = (userId, { status } = {}) =>
  prisma.application.findMany({
    where: { userId, ...(status ? { status } : {}) },
    orderBy: { createdAt: 'desc' },
  });

async function getById(userId, id) {
  const app = await prisma.application.findFirst({ where: { id, userId } });
  if (!app) throw new NotFoundError('Application not found');
  return app;
}

async function create(userId, data) {
  await assertCompany(userId, data.companyId);
  return prisma.application.create({ data: { ...data, userId } });
}

async function update(userId, id, data) {
  await getById(userId, id);
  await assertCompany(userId, data.companyId);
  return prisma.application.update({ where: { id }, data });
}

async function updateStatus(userId, id, status) {
  await getById(userId, id);
  return prisma.application.update({ where: { id }, data: { status } });
}

async function remove(userId, id) {
  await getById(userId, id);
  await prisma.application.delete({ where: { id } });
}

module.exports = { list, getById, create, update, updateStatus, remove };
