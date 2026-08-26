import { apiRoute } from "@/server/http/api-route";
import { json } from "@/server/http/respond";
import { applySelfUpdate, getSelfUpdateStatus } from "@/server/services/self-update-service";
import { writeAuditLog } from "@/server/services/audit-service";
import { clientIp } from "@/server/auth/session";

export const GET = apiRoute("updates.view", async () => {
  return json(await getSelfUpdateStatus());
});

export const POST = apiRoute("updates.execute", async (_req, session) => {
  const result = await applySelfUpdate();
  await writeAuditLog({
    userId: session.user.id,
    ip: await clientIp(),
    action: "SELF_UPDATE_STARTED",
    target: "proxora",
    result: result.ok ? "SUCCESS" : "FAILURE",
    error: result.ok ? null : result.message,
  });
  return json(result, result.ok ? 200 : 400);
});
