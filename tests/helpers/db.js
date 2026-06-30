const prisma = require('../../src/shared/database/prisma');

async function resetDb() {
  await prisma.applicationContact.deleteMany();
  await prisma.applicationDocument.deleteMany();
  await prisma.activityLog.deleteMany();
  await prisma.resumeAnalysis.deleteMany();
  await prisma.interview.deleteMany();
  await prisma.authoredDocument.deleteMany();
  await prisma.application.deleteMany();
  await prisma.contact.deleteMany();
  await prisma.document.deleteMany();
  await prisma.company.deleteMany();
  await prisma.image.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.user.deleteMany();
}

module.exports = { prisma, resetDb };
