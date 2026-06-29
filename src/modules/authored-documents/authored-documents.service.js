const prisma = require('../../shared/database/prisma');
const { NotFoundError } = require('../../shared/utils/errors');

const EMPTY_DOC = { type: 'doc', content: [{ type: 'paragraph' }] };

async function assertApplication(userId, applicationId) {
  if (!applicationId) return; // null/undefined => unlinked, nothing to check
  const app = await prisma.application.findFirst({ where: { id: applicationId, userId } });
  if (!app) throw new NotFoundError('Application not found');
}

const list = (userId) =>
  prisma.authoredDocument.findMany({
    where: { userId },
    orderBy: { updatedAt: 'desc' },
    select: { id: true, title: true, type: true, applicationId: true, updatedAt: true, createdAt: true },
  });

async function getById(userId, id) {
  const doc = await prisma.authoredDocument.findFirst({ where: { id, userId } });
  if (!doc) throw new NotFoundError('Document not found');
  return doc;
}

async function create(userId, data) {
  await assertApplication(userId, data.applicationId);
  return prisma.authoredDocument.create({
    data: {
      userId,
      title: data.title,
      type: data.type || 'Note',
      content: data.content || EMPTY_DOC,
      applicationId: data.applicationId ?? null,
    },
  });
}

async function update(userId, id, data) {
  await getById(userId, id);
  if (data.applicationId !== undefined) await assertApplication(userId, data.applicationId);
  return prisma.authoredDocument.update({ where: { id }, data });
}

async function remove(userId, id) {
  await getById(userId, id);
  await prisma.authoredDocument.delete({ where: { id } });
}

module.exports = { list, getById, create, update, remove };
