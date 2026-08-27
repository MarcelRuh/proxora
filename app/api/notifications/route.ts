import { z } from "zod";
import { encryptSecret, decryptSecret } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { apiRoute } from "@/server/http/api-route";
import { json } from "@/server/http/respond";
import { eventsFromConfig, NOTIFICATION_TOPICS } from "@/lib/notification-topics";

const schema = z.object({
  type: z.enum(["discord", "webhook"]),
  name: z.string().min(1),
  enabled: z.boolean().optional(),
  events: z.array(z.enum(NOTIFICATION_TOPICS)).optional(),
  config: z.record(z.string(), z.unknown()),
});

function publicChannel(row: { id: string; type: string; name: string; enabled: boolean; createdAt: Date; config: string }) {
  let events = null as ReturnType<typeof eventsFromConfig>;
  try {
    const config = JSON.parse(decryptSecret(row.config)) as Record<string, unknown>;
    events = eventsFromConfig(config);
  } catch {
    events = null;
  }
  return { id: row.id, type: row.type, name: row.name, enabled: row.enabled, createdAt: row.createdAt, events };
}

export const GET = apiRoute("notifications.view", async () => {
  const rows = await prisma.notificationChannel.findMany({ orderBy: { createdAt: "asc" } });
  return json({ channels: rows.map(publicChannel), topics: [...NOTIFICATION_TOPICS] });
});

export const POST = apiRoute("notifications.create", async (req) => {
  const body = schema.parse(await req.json());
  const config = { ...body.config };
  if (body.events !== undefined) config.events = body.events;
  const channel = await prisma.notificationChannel.create({
    data: {
      type: body.type,
      name: body.name,
      enabled: body.enabled ?? true,
      config: encryptSecret(JSON.stringify(config)),
    },
  });
  return json({ channel: publicChannel(channel) }, 201);
});
