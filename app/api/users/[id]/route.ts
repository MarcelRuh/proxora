import { apiRoute } from "@/server/http/api-route";
import { json } from "@/server/http/respond";
import { clientIp } from "@/server/auth/session";
import { writeAuditLog } from "@/server/services/audit-service";
import { AUDIT_ACTIONS } from "@/lib/audit-actions";
import { deleteUser, updateUser, updateUserSchema } from "@/server/services/user-service";

export const PATCH = apiRoute("users.manage", async (req, session, params) => {
  const body = updateUserSchema.parse(await req.json());
  const user = await updateUser(params.id, body);
  await writeAuditLog({
    userId: session.user.id,
    ip: await clientIp(),
    action: AUDIT_ACTIONS.USER_UPDATED,
    target: user.username,
    result: "SUCCESS",
  });
  return json({ user });
});

export const DELETE = apiRoute("users.manage", async (_req, session, params) => {
  await deleteUser(params.id, session.user.id);
  await writeAuditLog({
    userId: session.user.id,
    ip: await clientIp(),
    action: AUDIT_ACTIONS.USER_DELETED,
    target: params.id,
    result: "SUCCESS",
  });
  return json({ ok: true });
});
