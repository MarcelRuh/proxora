import { apiRoute } from "@/server/http/api-route";
import { json } from "@/server/http/respond";
import { clientIp } from "@/server/auth/session";
import { writeAuditLog } from "@/server/services/audit-service";
import { AUDIT_ACTIONS } from "@/lib/audit-actions";
import { createHost, hostInputSchema, listHosts, toPublicHost } from "@/server/services/host-service";

export const GET = apiRoute("hosts.view", async (_req, session) => {
  return json({ hosts: await listHosts(session.user) });
});

export const POST = apiRoute("hosts.create", async (req, session) => {
  const body = hostInputSchema.parse(await req.json());
  const host = await createHost(body);
  await writeAuditLog({
    userId: session.user.id,
    ip: await clientIp(),
    action: AUDIT_ACTIONS.HOST_ADDED,
    target: host.name,
    hostId: host.id,
    result: "SUCCESS",
  });
  return json({ host: toPublicHost(host) }, 201);
});
