import { apiRoute } from "@/server/http/api-route";
import { json } from "@/server/http/respond";
import { prisma } from "@/lib/db";

export const GET = apiRoute("settings.view", async () => {
  const settings = await prisma.setting.findMany();
  const channels = await prisma.notificationChannel.findMany({
    select: { id: true, type: true, name: true, enabled: true, createdAt: true },
  });
  return json({ settings, channels });
});

export const PATCH = apiRoute("settings.update", async (req) => {
  const body = (await req.json()) as { key: string; value: unknown };
  const setting = await prisma.setting.upsert({
    where: { key: body.key },
    update: { value: body.value as object },
    create: { key: body.key, value: body.value as object },
  });
  return json({ setting });
});
