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

export function unreadInboxCount(eventIds: string[], readIds: Iterable<string>): number {
  const read = new Set(readIds);
  return eventIds.filter((id) => !read.has(id)).length;
}

export async function listInboxForUser(user: SessionUser) {
  const scoped =
    user.allowedHostIds == null
      ? {}
      : { OR: [{ hostId: null }, { hostId: { in: user.allowedHostIds } }] };
  const rows = await prisma.inboxEvent.findMany({
    where: scoped,
    orderBy: { createdAt: "desc" },
    take: 40,
  });
  const events = rows.filter((row) => inboxVisibleTo(user, row.hostId));
  const reads = events.length
    ? await prisma.inboxRead.findMany({
        where: { userId: user.id, eventId: { in: events.map((row) => row.id) } },
        select: { eventId: true, readAt: true },
      })
    : [];
  const readAtById = new Map(reads.map((row) => [row.eventId, row.readAt]));
  return {
    unread: unreadInboxCount(
      events.map((row) => row.id),
      readAtById.keys(),
    ),
    events: events.map((row) => ({
      id: row.id,
      topic: row.topic,
      level: row.level,
      title: row.title,
      message: row.message,
      hostId: row.hostId,
      name: row.name,
      refId: row.refId,
      node: row.node,
      href: row.href,
      readAt: readAtById.get(row.id) ?? null,
      createdAt: row.createdAt,
    })),
  };
}

export async function markInboxReadForUser(
  user: SessionUser,
  body: { ids?: string[]; all?: boolean },
) {
  const scoped =
    user.allowedHostIds == null
      ? {}
      : { OR: [{ hostId: null }, { hostId: { in: user.allowedHostIds } }] };
  let ids: string[] = [];
  if (body.all) {
    const rows = await prisma.inboxEvent.findMany({
      where: scoped,
      select: { id: true, hostId: true },
    });
    ids = rows.filter((row) => inboxVisibleTo(user, row.hostId)).map((row) => row.id);
  } else if (body.ids?.length) {
    const rows = await prisma.inboxEvent.findMany({
      where: { id: { in: body.ids }, ...scoped },
      select: { id: true, hostId: true },
    });
    ids = rows.filter((row) => inboxVisibleTo(user, row.hostId)).map((row) => row.id);
  }
  if (!ids.length) return;
  await prisma.inboxRead.createMany({
    data: ids.map((eventId) => ({ userId: user.id, eventId })),
    skipDuplicates: true,
  });
}

export function inboxVisibleTo(user: SessionUser, hostId: string | null): boolean {
  if (!hostId) return true;
  return canAccessHost(user, hostId);
}

export function userReceivesInboxPush(user: SessionUser, hostId: string | null): boolean {
  if (!userHasAnyPermission(user, ["hosts.view", "notifications.view"])) return false;
  return inboxVisibleTo(user, hostId);
}
