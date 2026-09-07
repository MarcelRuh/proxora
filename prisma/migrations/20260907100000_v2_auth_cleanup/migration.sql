-- 2.0 auth: recovery codes + drop unused inbox readAt (per-user InboxRead is source of truth)
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "totpRecoveryHashes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

DROP INDEX IF EXISTS "InboxEvent_readAt_idx";
ALTER TABLE "InboxEvent" DROP COLUMN IF EXISTS "readAt";
