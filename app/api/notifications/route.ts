import { z } from "zod";
import { encryptSecret } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { apiRoute } from "@/server/http/api-route";
import { json } from "@/server/http/respond";

const schema = z.object({
  type: z.enum(["discord", "webhook", "email"]),
  name: z.string().min(1),
  enabled: z.boolean().optional(),
  config: z.record(z.string(), z.unknown()),
});

export const GET = apiRoute("settings.view", async () => {
  const channels = await prisma.notificationChannel.findMany({
    select: { id: true, type: true, name: true, enabled: true, createdAt: true },
  });
  return json({ channels });
});

export const POST = apiRoute("settings.manage", async (req) => {
  const body = schema.parse(await req.json());
  const channel = await prisma.notificationChannel.create({
    data: {
      type: body.type,
      name: body.name,
      enabled: body.enabled ?? true,
      config: encryptSecret(JSON.stringify(body.config)),
    },
    select: { id: true, type: true, name: true, enabled: true },
  });
  return json({ channel }, 201);
});
