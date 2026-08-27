-- CreateTable
CREATE TABLE "UserGuestAccess" (
    "userId" TEXT NOT NULL,
    "hostId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "vmid" INTEGER NOT NULL,

    CONSTRAINT "UserGuestAccess_pkey" PRIMARY KEY ("userId","hostId","kind","vmid")
);

-- CreateIndex
CREATE INDEX "UserGuestAccess_userId_idx" ON "UserGuestAccess"("userId");

-- CreateIndex
CREATE INDEX "UserGuestAccess_hostId_idx" ON "UserGuestAccess"("hostId");

-- AddForeignKey
ALTER TABLE "UserGuestAccess" ADD CONSTRAINT "UserGuestAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserGuestAccess" ADD CONSTRAINT "UserGuestAccess_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "Host"("id") ON DELETE CASCADE ON UPDATE CASCADE;
