const crypto = require('crypto');
const prisma = require('../../shared/database/prisma');
const storage = require('../../shared/storage');
const { NotFoundError, ConflictError } = require('../../shared/utils/errors');
const activity = require('../activity/activity.service');
const { extractRich } = require('../analysis/engine/extract');
const { indexDocument } = require('../rag/rag.service');
const { embeddingConfigured } = require('../analysis/engine/embeddings');

const publicSelect = {
  id: true, name: true, type: true, notes: true,
  originalFilename: true, mimeType: true, sizeBytes: true,
  createdAt: true, updatedAt: true,
};

const sanitize = (name) => name.replace(/[^\w.\-]+/g, '_').slice(0, 120);

function readBuffer(key) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    storage.createReadStream(key)
      .on('data', (c) => chunks.push(c))
      .on('end', () => resolve(Buffer.concat(chunks)))
      .on('error', reject);
  });
}

async function create(userId, { name, type, notes }, file) {
  const storageKey = `${userId}/${crypto.randomUUID()}-${sanitize(file.originalname)}`;
  await storage.save(file.buffer, storageKey);
  try {
    const doc = await prisma.document.create({
      data: {
        userId, name, type, notes,
        originalFilename: file.originalname, mimeType: file.mimetype, sizeBytes: file.size, storageKey,
      },
      select: publicSelect,
    });
    if (embeddingConfigured()) {
      indexDocument(userId, doc.id).catch((err) => console.warn(`[rag] index-on-upload failed for ${doc.id}: ${err.message}`));
    }
    return doc;
  } catch (e) {
    // Don't leak an orphaned blob if the DB insert fails after the file was written.
    await storage.remove(storageKey).catch(() => {});
    throw e;
  }
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

async function getText(userId, id) {
  const doc = await assertDocument(userId, id);
  const buffer = await readBuffer(doc.storageKey);
  return extractRich(buffer, doc.mimeType); // { ok, kind: 'html'|'text', content }
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

async function assertApplication(userId, applicationId) {
  const app = await prisma.application.findFirst({ where: { id: applicationId, userId } });
  if (!app) throw new NotFoundError('Application not found');
  return app;
}

async function linkApplication(userId, applicationId, documentId) {
  const app = await assertApplication(userId, applicationId);
  const doc = await assertDocument(userId, documentId);
  const existing = await prisma.applicationDocument.findUnique({
    where: { applicationId_documentId: { applicationId, documentId } },
  });
  if (existing) throw new ConflictError('Document already linked to this application');
  await prisma.applicationDocument.create({ data: { applicationId, documentId } });
  await activity.record(userId, 'DocumentLinked', { applicationId, metadata: { position: app.position, name: doc.name } });
  return prisma.document.findFirst({ where: { id: documentId }, select: publicSelect });
}

async function unlinkApplication(userId, applicationId, documentId) {
  await assertApplication(userId, applicationId);
  await assertDocument(userId, documentId);
  await prisma.applicationDocument.deleteMany({ where: { applicationId, documentId } });
}

module.exports = {
  create, list, publicSelect, assertDocument, getForDownload, getText, update, remove,
  linkApplication, unlinkApplication,
};
