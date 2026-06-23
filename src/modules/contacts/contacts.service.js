const prisma = require('../../shared/database/prisma');
const { NotFoundError, ConflictError } = require('../../shared/utils/errors');

const includeCompany = { company: { select: { id: true, name: true } } };

async function assertCompany(userId, companyId) {
  if (companyId === undefined || companyId === null) return;
  const company = await prisma.company.findFirst({ where: { id: companyId, userId } });
  if (!company) throw new NotFoundError('Company not found');
}

async function assertContact(userId, contactId) {
  const contact = await prisma.contact.findFirst({ where: { id: contactId, userId } });
  if (!contact) throw new NotFoundError('Contact not found');
  return contact;
}

async function assertApplication(userId, applicationId) {
  const app = await prisma.application.findFirst({ where: { id: applicationId, userId } });
  if (!app) throw new NotFoundError('Application not found');
  return app;
}

const list = (userId, search) =>
  prisma.contact.findMany({
    where: {
      userId,
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { email: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: 'desc' },
    include: includeCompany,
  });

async function getById(userId, id) {
  const contact = await prisma.contact.findFirst({
    where: { id, userId },
    include: {
      company: { select: { id: true, name: true } },
      applicationLinks: {
        include: {
          application: {
            select: { id: true, position: true, company: { select: { id: true, name: true } } },
          },
        },
      },
    },
  });
  if (!contact) throw new NotFoundError('Contact not found');
  const { applicationLinks, ...rest } = contact;
  return { ...rest, applications: applicationLinks.map((l) => l.application) };
}

async function create(userId, data) {
  await assertCompany(userId, data.companyId);
  return prisma.contact.create({ data: { ...data, userId }, include: includeCompany });
}

async function update(userId, id, data) {
  await assertContact(userId, id);
  await assertCompany(userId, data.companyId);
  return prisma.contact.update({ where: { id }, data, include: includeCompany });
}

async function remove(userId, id) {
  await assertContact(userId, id);
  await prisma.contact.delete({ where: { id } });
}

async function linkApplication(userId, applicationId, contactId) {
  await assertApplication(userId, applicationId);
  await assertContact(userId, contactId);
  const existing = await prisma.applicationContact.findUnique({
    where: { applicationId_contactId: { applicationId, contactId } },
  });
  if (existing) throw new ConflictError('Contact already linked to this application');
  await prisma.applicationContact.create({ data: { applicationId, contactId } });
  return prisma.contact.findFirst({ where: { id: contactId }, include: includeCompany });
}

async function unlinkApplication(userId, applicationId, contactId) {
  await assertApplication(userId, applicationId);
  await assertContact(userId, contactId);
  await prisma.applicationContact.deleteMany({ where: { applicationId, contactId } });
}

module.exports = {
  list, getById, create, update, remove,
  assertContact, linkApplication, unlinkApplication,
};
