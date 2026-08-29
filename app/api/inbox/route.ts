import { z } from "zod";
import { apiRoute } from "@/server/http/api-route";
import { json } from "@/server/http/respond";
import { prisma } from "@/lib/db";
import { inboxVisibleTo } from "@/server/services/inbox-service";

export const GET = apiRoute(["hosts.view", "notifications.view"], async (_req, session) => {
  const scoped =
    session.user.allowedHostIds == null
      ? {}
      : { OR: [{ hostId: null }, { hostId: { in: session.user.allowedHostIds } }] };
  const rows = await prisma.inboxEvent.findMany({
    where: scoped,
    orderBy: { createdAt: "desc" },
    take: 40,
  });
  const events = rows.filter((row) => inboxVisibleTo(session.user, row.hostId));
  return json({
    unread: events.filter((row) => !row.readAt).length,
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
      readAt: row.readAt,
      createdAt: row.createdAt,
    })),
  });
});

const patchSchema = z.object({
  ids: z.array(z.string()).optional(),
  all: z.boolean().optional(),
});

export const PATCH = apiRoute(["hosts.view", "notifications.view"], async (req, session) => {
  const body = patchSchema.parse(await req.json().catch(() => ({})));
  const now = new Date();
  if (body.all) {
    await prisma.inboxEvent.updateMany({
      where: {
        readAt: null,
        ...(session.user.allowedHostIds
          ? { OR: [{ hostId: null }, { hostId: { in: session.user.allowedHostIds } }] }
          : {}),
      },
      data: { readAt: now },
    });
  } else if (body.ids?.length) {
    await prisma.inboxEvent.updateMany({
      where: { id: { in: body.ids }, readAt: null },
      data: { readAt: now },
    });
  }
  return json({ ok: true });
});
