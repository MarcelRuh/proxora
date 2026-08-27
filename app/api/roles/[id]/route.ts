import { apiRoute } from "@/server/http/api-route";
import { json } from "@/server/http/respond";
import { clientIp } from "@/server/auth/session";
import { writeAuditLog } from "@/server/services/audit-service";
import { AUDIT_ACTIONS } from "@/lib/audit-actions";
import { createRoleSchema, deleteRole, updateRole } from "@/server/services/user-service";

export const PATCH = apiRoute("roles.update", async (req, session, params) => {
  const body = createRoleSchema.partial().parse(await req.json());
  const role = await updateRole(params.id, body);
  await writeAuditLog({
    userId: session.user.id,
    ip: await clientIp(),
    action: AUDIT_ACTIONS.ROLE_UPDATED,
    target: role.slug,
    result: "SUCCESS",
  });
  return json({ role });
});

export const DELETE = apiRoute("roles.delete", async (_req, session, params) => {
  await deleteRole(params.id);
  await writeAuditLog({
    userId: session.user.id,
    ip: await clientIp(),
    action: AUDIT_ACTIONS.ROLE_DELETED,
    target: params.id,
    result: "SUCCESS",
  });
  return json({ ok: true });
});
