const prisma = require('../../src/shared/database/prisma');

async function resetDb() {
  await prisma.interview.deleteMany();
  await prisma.application.deleteMany();
  await prisma.company.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.user.deleteMany();
}

module.exports = { prisma, resetDb };
