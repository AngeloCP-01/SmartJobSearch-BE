-- CreateEnum
CREATE TYPE "AuthoredDocType" AS ENUM ('Resume', 'CoverLetter', 'Note');

-- CreateTable
CREATE TABLE "AuthoredDocument" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" "AuthoredDocType" NOT NULL DEFAULT 'Note',
    "content" JSONB NOT NULL,
    "applicationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuthoredDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuthoredDocument_userId_idx" ON "AuthoredDocument"("userId");

-- CreateIndex
CREATE INDEX "AuthoredDocument_applicationId_idx" ON "AuthoredDocument"("applicationId");

-- AddForeignKey
ALTER TABLE "AuthoredDocument" ADD CONSTRAINT "AuthoredDocument_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthoredDocument" ADD CONSTRAINT "AuthoredDocument_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE SET NULL ON UPDATE CASCADE;
