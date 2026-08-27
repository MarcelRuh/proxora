import { apiRoute } from "@/server/http/api-route";
import { json } from "@/server/http/respond";
import { clientIp } from "@/server/auth/session";
import { writeAuditLog } from "@/server/services/audit-service";
import { AUDIT_ACTIONS } from "@/lib/audit-actions";
import { ALL_PERMISSIONS, PERMISSION_CATALOG, PERMISSION_GROUPS } from "@/lib/permissions";
import { createRole, createRoleSchema, listRoles } from "@/server/services/user-service";

export const GET = apiRoute("roles.view", async () => {
  return json({
    roles: await listRoles(),
    permissions: ALL_PERMISSIONS,
    catalog: PERMISSION_CATALOG,
    groups: PERMISSION_GROUPS,
  });
});

export const POST = apiRoute("roles.create", async (req, session) => {
  const body = createRoleSchema.parse(await req.json());
  const role = await createRole(body);
  await writeAuditLog({
    userId: session.user.id,
    ip: await clientIp(),
    action: AUDIT_ACTIONS.ROLE_CREATED,
    target: role.slug,
    result: "SUCCESS",
  });
  return json({ role }, 201);
});
