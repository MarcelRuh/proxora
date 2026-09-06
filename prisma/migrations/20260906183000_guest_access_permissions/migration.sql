-- AlterTable
ALTER TABLE "UserGuestAccess" ADD COLUMN "permissions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "UserGuestAccess" ADD COLUMN "override" BOOLEAN NOT NULL DEFAULT false;
