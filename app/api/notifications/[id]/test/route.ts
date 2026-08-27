import { decryptSecret } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";
import { apiRoute } from "@/server/http/api-route";
import { json } from "@/server/http/respond";
import { sendNotificationTest } from "@/server/notifications/send-test";

export const POST = apiRoute("notifications.update", async (_req, _session, params) => {
  const existing = await prisma.notificationChannel.findUnique({ where: { id: params.id } });
  if (!existing) throw new NotFoundError("Notification channel not found");
  let config: Record<string, unknown> = {};
  try {
    config = JSON.parse(decryptSecret(existing.config)) as Record<string, unknown>;
  } catch {
    config = {};
  }
  await sendNotificationTest(existing.type, config);
  return json({ ok: true });
});
