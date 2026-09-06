import { z } from "zod";
import { apiRoute } from "@/server/http/api-route";
import { json } from "@/server/http/respond";
import { clientUserAgent } from "@/server/auth/session";
import { deletePushSubscription, savePushSubscription } from "@/server/services/push-service";

const subscribeSchema = z.object({
  endpoint: z.string().url().max(2048),
  keys: z.object({
    p256dh: z.string().min(8).max(256),
    auth: z.string().min(8).max(256),
  }),
});

export const POST = apiRoute(["hosts.view", "notifications.view"], async (req, session) => {
  const body = subscribeSchema.parse(await req.json());
  await savePushSubscription({
    userId: session.user.id,
    endpoint: body.endpoint,
    p256dh: body.keys.p256dh,
    auth: body.keys.auth,
    userAgent: await clientUserAgent(),
  });
  return json({ ok: true });
});

const unsubscribeSchema = z.object({
  endpoint: z.string().url().max(2048),
});

export const DELETE = apiRoute(["hosts.view", "notifications.view"], async (req, session) => {
  const body = unsubscribeSchema.parse(await req.json().catch(() => ({})));
  await deletePushSubscription(session.user.id, body.endpoint);
  return json({ ok: true });
});
