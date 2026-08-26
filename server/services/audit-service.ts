import { AuditResult, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import type { AuditAction } from "@/lib/audit-actions";

export async function writeAuditLog(entry: {
  userId?: string | null;
  ip?: string | null;
  action: AuditAction | string;
  target?: string | null;
  hostId?: string | null;
  result: AuditResult;
  error?: string | null;
  metadata?: Prisma.InputJsonValue;
}) {
  try {
    await prisma.auditLog.create({
      data: {
        userId: entry.userId ?? undefined,
        ip: entry.ip ?? undefined,
        action: entry.action,
        target: entry.target ?? undefined,
        hostId: entry.hostId ?? undefined,
        result: entry.result,
        error: entry.error ?? undefined,
        metadata: entry.metadata,
      },
    });
  } catch (error) {
    logger.error({ err: error, action: entry.action }, "Failed to write audit log");
  }
}
