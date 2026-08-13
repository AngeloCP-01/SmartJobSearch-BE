const prisma = require('../../shared/database/prisma');
const { NotFoundError } = require('../../shared/utils/errors');
const activity = require('../activity/activity.service');

const includeCompany = { company: { select: { id: true, name: true } } };

async function assertCompany(userId, companyId) {
  if (companyId === undefined || companyId === null) return;
  const company = await prisma.company.findFirst({ where: { id: companyId, userId } });
  if (!company) throw new NotFoundError('Company not found');
}

// Sort keys are an allowlist — user input never reaches Prisma's orderBy.
const ORDER_BY = {
  position: (dir) => ({ position: dir }),
  company: (dir) => ({ company: { name: dir } }),
  status: (dir) => ({ status: dir }),
  applicationDate: (dir) => ({ applicationDate: dir }),
  createdAt: (dir) => ({ createdAt: dir }),
};

function buildWhere(userId, { status, companyId, search }) {
  return {
    userId,
    ...(status ? { status } : {}),
    ...(companyId ? { companyId } : {}),
    ...(search
      ? {
        OR: [
          { position: { contains: search, mode: 'insensitive' } },
          { company: { name: { contains: search, mode: 'insensitive' } } },
        ],
      }
      : {}),
  };
}

// Returns { items, total } always. Without `take` this is the unpaginated v1
// path and deliberately skips COUNT(*) — v1 must not start paying for a count
// it never reads.
async function list(userId, {
  status, companyId, search, sort = 'createdAt', dir = 'desc', skip, take,
} = {}) {
  const where = buildWhere(userId, { status, companyId, search });
  // `id` breaks ties so the sort is a total order. SQL guarantees nothing about
  // the relative order of rows with equal sort keys, so without this a row
  // sharing a createdAt (or status, or company) with others could in principle
  // land on both page 1 and page 2 while another is never returned.
  // Not a reproduced bug — Postgres returns a stable order for the small tables
  // tested here — but the plan can change as tables grow or indexes are added,
  // and the guarantee costs nothing. Same reason activity orders by
  // [createdAt, id].
  const orderBy = [(ORDER_BY[sort] || ORDER_BY.createdAt)(dir), { id: dir }];

  if (take === undefined) {
    const items = await prisma.application.findMany({ where, orderBy, include: includeCompany });
    return { items, total: items.length };
  }

  const [items, total] = await prisma.$transaction([
    prisma.application.findMany({
      where, orderBy, include: includeCompany, skip, take,
    }),
    prisma.application.count({ where }),
  ]);
  return { items, total };
}

async function getById(userId, id) {
  const app = await prisma.application.findFirst({
    where: { id, userId },
    include: {
      company: { select: { id: true, name: true } },
      contactLinks: {
        include: {
          contact: {
            select: { id: true, name: true, position: true, company: { select: { id: true, name: true } } },
          },
        },
      },
      documentLinks: {
        include: {
          document: {
            select: { id: true, name: true, type: true, originalFilename: true, mimeType: true, sizeBytes: true },
          },
        },
      },
    },
  });
  if (!app) throw new NotFoundError('Application not found');
  const { contactLinks, documentLinks, ...rest } = app;
  return { ...rest, contacts: contactLinks.map((l) => l.contact), documents: documentLinks.map((l) => l.document) };
}

async function create(userId, data) {
  await assertCompany(userId, data.companyId);
  const app = await prisma.application.create({ data: { ...data, userId }, include: includeCompany });
  await activity.record(userId, 'ApplicationCreated', { applicationId: app.id, metadata: { position: app.position } });
  return app;
}

async function update(userId, id, data) {
  await getById(userId, id);
  await assertCompany(userId, data.companyId);
  return prisma.application.update({ where: { id }, data, include: includeCompany });
}

async function updateStatus(userId, id, status) {
  const existing = await getById(userId, id);
  const app = await prisma.application.update({ where: { id }, data: { status }, include: includeCompany });
  if (existing.status !== status) {
    await activity.record(userId, 'ApplicationStatusChanged', {
      applicationId: id,
      metadata: { position: app.position, from: existing.status, to: status },
    });
  }
  return app;
}

async function remove(userId, id) {
  const existing = await getById(userId, id);
  await prisma.application.delete({ where: { id } });
  await activity.record(userId, 'ApplicationDeleted', { applicationId: null, metadata: { position: existing.position } });
}

module.exports = { list, getById, create, update, updateStatus, remove };
