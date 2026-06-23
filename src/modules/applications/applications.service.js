const prisma = require('../../shared/database/prisma');
const { NotFoundError } = require('../../shared/utils/errors');

const includeCompany = { company: { select: { id: true, name: true } } };

async function assertCompany(userId, companyId) {
  if (companyId === undefined || companyId === null) return;
  const company = await prisma.company.findFirst({ where: { id: companyId, userId } });
  if (!company) throw new NotFoundError('Company not found');
}

const list = (userId, { status } = {}) =>
  prisma.application.findMany({
    where: { userId, ...(status ? { status } : {}) },
    orderBy: { createdAt: 'desc' },
    include: includeCompany,
  });

async function getById(userId, id) {
  const app = await prisma.application.findFirst({ where: { id, userId }, include: includeCompany });
  if (!app) throw new NotFoundError('Application not found');
  return app;
}

async function create(userId, data) {
  await assertCompany(userId, data.companyId);
  return prisma.application.create({ data: { ...data, userId }, include: includeCompany });
}

async function update(userId, id, data) {
  await getById(userId, id);
  await assertCompany(userId, data.companyId);
  return prisma.application.update({ where: { id }, data, include: includeCompany });
}

async function updateStatus(userId, id, status) {
  await getById(userId, id);
  return prisma.application.update({ where: { id }, data: { status }, include: includeCompany });
}

async function remove(userId, id) {
  await getById(userId, id);
  await prisma.application.delete({ where: { id } });
}

module.exports = { list, getById, create, update, updateStatus, remove };
