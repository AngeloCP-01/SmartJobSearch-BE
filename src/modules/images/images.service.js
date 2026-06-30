const crypto = require('crypto');
const prisma = require('../../shared/database/prisma');
const storage = require('../../shared/storage');
const { NotFoundError } = require('../../shared/utils/errors');

const sanitize = (name) => name.replace(/[^\w.\-]/g, '_');

async function create(userId, file) {
  const storageKey = `images/${userId}/${crypto.randomUUID()}-${sanitize(file.originalname)}`;
  await storage.save(file.buffer, storageKey);
  try {
    return await prisma.image.create({
      data: { userId, storageKey, mimeType: file.mimetype, sizeBytes: file.size },
    });
  } catch (e) {
    await storage.remove(storageKey).catch(() => {});
    throw e;
  }
}

// Public serve: looked up by id only (no userId scoping — the URL is the capability).
async function getForServe(id) {
  const image = await prisma.image.findUnique({ where: { id } });
  if (!image) throw new NotFoundError('Image not found');
  return image;
}

module.exports = { create, getForServe };
