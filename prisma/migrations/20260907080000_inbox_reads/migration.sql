-- CreateTable
CREATE TABLE "InboxRead" (
    "userId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InboxRead_pkey" PRIMARY KEY ("userId","eventId")
);

-- CreateIndex
CREATE INDEX "InboxRead_userId_readAt_idx" ON "InboxRead"("userId", "readAt");

-- AddForeignKey
ALTER TABLE "InboxRead" ADD CONSTRAINT "InboxRead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboxRead" ADD CONSTRAINT "InboxRead_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "InboxEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
