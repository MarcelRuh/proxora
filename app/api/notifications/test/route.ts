import { z } from "zod";
import { json } from "@/server/http/respond";
import { apiRoute } from "@/server/http/api-route";
import { sendNotificationTest } from "@/server/notifications/send-test";

const schema = z.object({
  url: z.string().trim().min(12),
  type: z.enum(["discord", "webhook"]).optional(),
});

export const POST = apiRoute("notifications.update", async (req) => {
  const body = schema.parse(await req.json());
  await sendNotificationTest(body.type ?? "discord", { url: body.url });
  return json({ ok: true });
});
