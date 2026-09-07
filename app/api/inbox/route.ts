import { z } from "zod";
import { apiRoute } from "@/server/http/api-route";
import { json } from "@/server/http/respond";
import { listInboxForUser, markInboxReadForUser } from "@/server/services/inbox-service";

export const GET = apiRoute(["hosts.view", "notifications.view"], async (_req, session) => {
  return json(await listInboxForUser(session.user));
});

const patchSchema = z.object({
  ids: z.array(z.string()).optional(),
  all: z.boolean().optional(),
});

export const PATCH = apiRoute(["hosts.view", "notifications.view"], async (req, session) => {
  const body = patchSchema.parse(await req.json().catch(() => ({})));
  await markInboxReadForUser(session.user, body);
  return json({ ok: true });
});
