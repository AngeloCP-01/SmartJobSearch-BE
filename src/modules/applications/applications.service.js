const prisma = require('../../shared/database/prisma');
const { NotFoundError } = require('../../shared/utils/errors');
const activity = require('../activity/activity.service');

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
