-- CreateEnum
CREATE TYPE "WorkMode" AS ENUM ('Remote', 'Hybrid', 'OnSite');

-- AlterTable
ALTER TABLE "Application" ADD COLUMN     "workMode" "WorkMode";
