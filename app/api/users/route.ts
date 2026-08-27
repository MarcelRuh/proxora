import { apiRoute } from "@/server/http/api-route";
import { json } from "@/server/http/respond";
import { clientIp } from "@/server/auth/session";
import { writeAuditLog } from "@/server/services/audit-service";
import { AUDIT_ACTIONS } from "@/lib/audit-actions";
import { createUser, createUserSchema, listUsers } from "@/server/services/user-service";

export const GET = apiRoute("users.view", async () => {
  return json({ users: await listUsers() });
});

export const POST = apiRoute("users.create", async (req, session) => {
  const body = createUserSchema.parse(await req.json());
  const user = await createUser(body);
  await writeAuditLog({
    userId: session.user.id,
    ip: await clientIp(),
    action: AUDIT_ACTIONS.USER_CREATED,
    target: user.username,
    result: "SUCCESS",
  });
  return json({ user }, 201);
});
