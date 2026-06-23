const prisma = require('../../shared/database/prisma');
const { NotFoundError } = require('../../shared/utils/errors');

const list = (userId, search) =>
  prisma.company.findMany({
    where: { userId, ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}) },
    orderBy: { createdAt: 'desc' },
  });

async function getById(userId, id) {
  const company = await prisma.company.findFirst({ where: { id, userId } });
  if (!company) throw new NotFoundError('Company not found');
  return company;
}

const create = (userId, data) => prisma.company.create({ data: { ...data, userId } });

async function update(userId, id, data) {
  await getById(userId, id);
  return prisma.company.update({ where: { id }, data });
}

async function remove(userId, id) {
  await getById(userId, id);
  await prisma.company.delete({ where: { id } });
}

module.exports = { list, getById, create, update, remove };
