import { z } from "zod";
import { json } from "@/server/http/respond";
import { apiRoute } from "@/server/http/api-route";
import { sendNotificationTest } from "@/server/notifications/send-test";

const schema = z.object({
  url: z.string().trim().min(12).optional(),
  type: z.enum(["discord", "webhook", "smtp"]).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});

export const POST = apiRoute("notifications.update", async (req) => {
  const body = schema.parse(await req.json());
  const type = body.type ?? "discord";
  await sendNotificationTest(type, body.config ?? { url: body.url });
  return json({ ok: true });
});
