-- CreateTable
CREATE TABLE "InboxEvent" (
    "id" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "hostId" TEXT,
    "name" TEXT,
    "refId" TEXT,
    "node" TEXT,
    "href" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InboxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InboxEvent_createdAt_idx" ON "InboxEvent"("createdAt");

-- CreateIndex
CREATE INDEX "InboxEvent_readAt_idx" ON "InboxEvent"("readAt");

-- CreateIndex
CREATE INDEX "InboxEvent_hostId_idx" ON "InboxEvent"("hostId");
