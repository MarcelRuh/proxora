import { apiRoute } from "@/server/http/api-route";
import { json } from "@/server/http/respond";
import { clientIp } from "@/server/auth/session";
import { writeAuditLog } from "@/server/services/audit-service";
import { AUDIT_ACTIONS } from "@/lib/audit-actions";
import { testHost } from "@/server/services/host-service";

export const POST = apiRoute("hosts.view", async (_req, session, params) => {
  const result = await testHost(params.id, session.user);
  await writeAuditLog({
    userId: session.user.id,
    ip: await clientIp(),
    action: AUDIT_ACTIONS.HOST_TESTED,
    target: params.id,
    hostId: params.id,
    result: result.ok ? "SUCCESS" : "FAILURE",
    error: result.error,
  });
  return json(result, result.ok ? 200 : 400);
});
