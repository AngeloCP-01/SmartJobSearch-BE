const crypto = require('crypto');
const prisma = require('../../shared/database/prisma');
const storage = require('../../shared/storage');
const { NotFoundError } = require('../../shared/utils/errors');

const publicSelect = {
  id: true, name: true, type: true, notes: true,
  originalFilename: true, mimeType: true, sizeBytes: true,
  createdAt: true, updatedAt: true,
};

const sanitize = (name) => name.replace(/[^\w.\-]+/g, '_').slice(0, 120);

async function create(userId, { name, type, notes }, file) {
  const storageKey = `${userId}/${crypto.randomUUID()}-${sanitize(file.originalname)}`;
  await storage.save(file.buffer, storageKey);
  return prisma.document.create({
    data: {
      userId, name, type, notes,
      originalFilename: file.originalname, mimeType: file.mimetype, sizeBytes: file.size, storageKey,
    },
    select: publicSelect,
  });
}

function list(userId, { search, type } = {}) {
  return prisma.document.findMany({
    where: {
      userId,
      ...(type ? { type } : {}),
      ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    select: publicSelect,
  });
}

async function assertDocument(userId, id) {
  const doc = await prisma.document.findFirst({ where: { id, userId } });
  if (!doc) throw new NotFoundError('Document not found');
  return doc;
}

async function getForDownload(userId, id) {
  const doc = await assertDocument(userId, id);
  return { storageKey: doc.storageKey, mimeType: doc.mimeType, originalFilename: doc.originalFilename };
}

async function update(userId, id, data) {
  await assertDocument(userId, id);
  return prisma.document.update({ where: { id }, data, select: publicSelect });
}

async function remove(userId, id) {
  const doc = await assertDocument(userId, id);
  await prisma.document.delete({ where: { id } });
  await storage.remove(doc.storageKey);
}

module.exports = { create, list, publicSelect, assertDocument, getForDownload, update, remove };
