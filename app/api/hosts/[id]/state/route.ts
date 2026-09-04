import { z } from "zod";
import { apiRoute } from "@/server/http/api-route";
import { json } from "@/server/http/respond";
import { clientIp } from "@/server/auth/session";
import { writeAuditLog } from "@/server/services/audit-service";
import { AUDIT_ACTIONS } from "@/lib/audit-actions";
import { setHostState, toPublicHost } from "@/server/services/host-service";

const bodySchema = z.object({
  state: z.enum(["MAINTENANCE", "ONLINE"]),
});

export const POST = apiRoute("hosts.update", async (req, session, params) => {
  const body = bodySchema.parse(await req.json());
  const host = await setHostState(params.id, body.state, session.user);
  await writeAuditLog({
    userId: session.user.id,
    ip: await clientIp(),
    action: AUDIT_ACTIONS.HOST_UPDATED,
    target: host.name,
    hostId: host.id,
    result: "SUCCESS",
    metadata: { connectionState: host.connectionState, requested: body.state },
  });
  return json({ host: toPublicHost(host) });
});
