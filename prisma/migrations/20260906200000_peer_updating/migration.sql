-- AlterTable
ALTER TABLE "WireguardPeer" ADD COLUMN "updatingUntil" TIMESTAMP(3);
ALTER TABLE "WireguardPeer" ADD COLUMN "updatingFrom" TEXT;
ALTER TABLE "WireguardPeer" ADD COLUMN "updatingTo" TEXT;
