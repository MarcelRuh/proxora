-- AlterTable
ALTER TABLE "HostShare" ADD COLUMN "permissions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "Host" ADD COLUMN "peerSharePermissions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
