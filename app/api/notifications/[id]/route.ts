import { z } from "zod";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { apiRoute } from "@/server/http/api-route";
import { json } from "@/server/http/respond";
import { NotFoundError } from "@/lib/errors";
import { eventsFromConfig, NOTIFICATION_TOPICS } from "@/lib/notification-topics";

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
  events: z.array(z.enum(NOTIFICATION_TOPICS)).optional(),
  url: z.string().min(8).optional(),
});

export const PATCH = apiRoute("settings.manage", async (req, _session, params) => {
  const body = patchSchema.parse(await req.json());
  const existing = await prisma.notificationChannel.findUnique({ where: { id: params.id } });
  if (!existing) throw new NotFoundError("Notification channel not found");
  let config: Record<string, unknown> = {};
  try {
    config = JSON.parse(decryptSecret(existing.config)) as Record<string, unknown>;
  } catch {
    config = {};
  }
  if (body.events !== undefined) config.events = body.events;
  if (body.url) config.url = body.url;
  const channel = await prisma.notificationChannel.update({
    where: { id: existing.id },
    data: {
      name: body.name ?? existing.name,
      enabled: body.enabled ?? existing.enabled,
      config: encryptSecret(JSON.stringify(config)),
    },
  });
  let events = eventsFromConfig(config);
  return json({
    channel: {
      id: channel.id,
      type: channel.type,
      name: channel.name,
      enabled: channel.enabled,
      events,
    },
  });
});

export const DELETE = apiRoute("settings.manage", async (_req, _session, params) => {
  const existing = await prisma.notificationChannel.findUnique({ where: { id: params.id } });
  if (!existing) throw new NotFoundError("Notification channel not found");
  await prisma.notificationChannel.delete({ where: { id: existing.id } });
  return json({ ok: true });
});
