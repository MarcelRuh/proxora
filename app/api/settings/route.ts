import { apiRoute } from "@/server/http/api-route";
import { json } from "@/server/http/respond";
import { prisma } from "@/lib/db";
import { ValidationError } from "@/lib/errors";
import { isPublicSettingKey, PUBLIC_SETTING_KEYS } from "@/lib/settings-keys";

export const GET = apiRoute("settings.view", async () => {
  const settings = await prisma.setting.findMany({
    where: { key: { in: [...PUBLIC_SETTING_KEYS] } },
  });
  const channels = await prisma.notificationChannel.findMany({
    select: { id: true, type: true, name: true, enabled: true, createdAt: true },
  });
  return json({ settings, channels });
});

export const PATCH = apiRoute("settings.update", async (req) => {
  const body = (await req.json()) as { key: string; value: unknown };
  if (!isPublicSettingKey(body.key)) throw new ValidationError("Unknown setting");
  const setting = await prisma.setting.upsert({
    where: { key: body.key },
    update: { value: body.value as object },
    create: { key: body.key, value: body.value as object },
  });
  return json({ setting });
});
