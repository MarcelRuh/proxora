-- CreateEnum
CREATE TYPE "HostOrigin" AS ENUM ('LOCAL', 'PEER');

-- CreateEnum
CREATE TYPE "WireguardPeerKind" AS ENUM ('PROXORA', 'GATEWAY');

-- CreateEnum
CREATE TYPE "PeerShareLevel" AS ENUM ('VIEW', 'CONTROL', 'CREATE');

-- AlterTable
ALTER TABLE "Host" ADD COLUMN     "origin" "HostOrigin" NOT NULL DEFAULT 'LOCAL',
ADD COLUMN     "peerId" TEXT,
ADD COLUMN     "remoteHostId" TEXT,
ADD COLUMN     "peerShareLevel" "PeerShareLevel";

-- CreateTable
CREATE TABLE "WireguardPeer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "WireguardPeerKind" NOT NULL DEFAULT 'PROXORA',
    "publicKey" TEXT NOT NULL DEFAULT '',
    "endpoint" TEXT NOT NULL DEFAULT '',
    "address" TEXT NOT NULL DEFAULT '',
    "allowedIPs" TEXT NOT NULL DEFAULT '',
    "persistentKeepalive" INTEGER NOT NULL DEFAULT 25,
    "inboundTokenHash" TEXT NOT NULL,
    "encryptedInboundToken" TEXT NOT NULL,
    "encryptedOutboundToken" TEXT NOT NULL DEFAULT '',
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WireguardPeer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HostShare" (
    "id" TEXT NOT NULL,
    "peerId" TEXT NOT NULL,
    "hostId" TEXT NOT NULL,
    "level" "PeerShareLevel" NOT NULL,

    CONSTRAINT "HostShare_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WireguardPeer_inboundTokenHash_key" ON "WireguardPeer"("inboundTokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "HostShare_peerId_hostId_key" ON "HostShare"("peerId", "hostId");

-- CreateIndex
CREATE INDEX "HostShare_hostId_idx" ON "HostShare"("hostId");

-- CreateIndex
CREATE INDEX "Host_origin_idx" ON "Host"("origin");

-- CreateIndex
CREATE UNIQUE INDEX "Host_peerId_remoteHostId_key" ON "Host"("peerId", "remoteHostId");

-- AddForeignKey
ALTER TABLE "Host" ADD CONSTRAINT "Host_peerId_fkey" FOREIGN KEY ("peerId") REFERENCES "WireguardPeer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HostShare" ADD CONSTRAINT "HostShare_peerId_fkey" FOREIGN KEY ("peerId") REFERENCES "WireguardPeer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HostShare" ADD CONSTRAINT "HostShare_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "Host"("id") ON DELETE CASCADE ON UPDATE CASCADE;
