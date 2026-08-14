const prisma = require('../../shared/database/prisma');
const { NotFoundError } = require('../../shared/utils/errors');

// Sort keys are an allowlist — user input never reaches Prisma's orderBy.
const ORDER_BY = {
  name: (dir) => ({ name: dir }),
  createdAt: (dir) => ({ createdAt: dir }),
};

const buildWhere = (userId, search) => ({
  userId,
  ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}),
});

// Returns { items, total } always. Without `take` this is the unpaginated v1
// path and deliberately skips COUNT(*) — v1 must not pay for a count it never
// reads. `id` breaks sort ties so paging is a total order.
async function list(userId, {
  search, sort = 'createdAt', dir = 'desc', skip, take,
} = {}) {
  const where = buildWhere(userId, search);
  const orderBy = [(ORDER_BY[sort] || ORDER_BY.createdAt)(dir), { id: dir }];

  if (take === undefined) {
    const items = await prisma.company.findMany({ where, orderBy });
    return { items, total: items.length };
  }

  const [items, total] = await prisma.$transaction([
    prisma.company.findMany({ where, orderBy, skip, take }),
    prisma.company.count({ where }),
  ]);
  return { items, total };
}

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
