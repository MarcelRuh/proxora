-- AlterTable
ALTER TABLE "UserHostAccess" ADD COLUMN "permissions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "UserHostAccess" ADD COLUMN "override" BOOLEAN NOT NULL DEFAULT false;
