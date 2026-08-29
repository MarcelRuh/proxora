import { prisma } from "@/lib/db";
import { canAccessHost, type SessionUser } from "@/server/auth/session-core";
import type { NotificationEvent } from "@/server/notifications/providers";

const INBOX_KEEP = 200;

export async function recordInboxEvent(event: NotificationEvent): Promise<void> {
  if (event.topic === "test") return;
  await prisma.inboxEvent.create({
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
}

export function inboxVisibleTo(user: SessionUser, hostId: string | null): boolean {
  if (!hostId) return true;
  return canAccessHost(user, hostId);
}
