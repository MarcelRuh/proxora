import { prisma } from "@/lib/db";
import { userHasAnyPermission } from "@/lib/permissions";
import { canAccessHost, type SessionUser } from "@/server/auth/session-core";
import type { NotificationEvent } from "@/server/notifications/providers";
import { buildPushPayload, type PushPayload } from "@/lib/push-payload";

const INBOX_KEEP = 200;

export type InboxRecord = PushPayload & { hostId: string | null };

export async function recordInboxEvent(event: NotificationEvent): Promise<InboxRecord | null> {
  if (event.topic === "test") return null;
  const row = await prisma.inboxEvent.create({
    data: {
      topic: event.topic,
      level: event.level,
      title: event.title,
      message: event.message,
      hostId: event.hostId,
      name: event.name,
      refId: event.id,
      node: event.node,
      href: event.href,
    },
  });
  const extra = (await prisma.inboxEvent.count()) - INBOX_KEEP;
  if (extra > 0) {
    const old = await prisma.inboxEvent.findMany({
      orderBy: { createdAt: "asc" },
      take: extra,
      select: { id: true },
    });
    if (old.length) {
      await prisma.inboxEvent.deleteMany({ where: { id: { in: old.map((row) => row.id) } } });
    }
  }
  return {
    ...buildPushPayload({
      id: row.id,
      title: row.title,
      message: row.message,
      href: row.href,
    }),
    hostId: row.hostId,
  };
}

export function inboxVisibleTo(user: SessionUser, hostId: string | null): boolean {
  if (!hostId) return true;
  return canAccessHost(user, hostId);
}

export function userReceivesInboxPush(user: SessionUser, hostId: string | null): boolean {
  if (!userHasAnyPermission(user, ["hosts.view", "notifications.view"])) return false;
  return inboxVisibleTo(user, hostId);
}
