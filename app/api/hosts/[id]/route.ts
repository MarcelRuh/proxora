import { apiRoute } from "@/server/http/api-route";
import { json } from "@/server/http/respond";
import { clientIp } from "@/server/auth/session";
import { writeAuditLog } from "@/server/services/audit-service";
import { AUDIT_ACTIONS } from "@/lib/audit-actions";
import {
  deleteHost,
  getHostOrThrow,
  hostUpdateSchema,
  toPublicHost,
  updateHost,
} from "@/server/services/host-service";

export const GET = apiRoute("hosts.view", async (_req, session, params) => {
  const host = await getHostOrThrow(params.id, session.user);
  return json({ host: toPublicHost(host) });
});

export const PATCH = apiRoute("hosts.edit", async (req, session, params) => {
  const body = hostUpdateSchema.parse(await req.json());
  const host = await updateHost(params.id, body, session.user);
  await writeAuditLog({
    userId: session.user.id,
    ip: await clientIp(),
    action: AUDIT_ACTIONS.HOST_UPDATED,
    target: host.name,
    hostId: host.id,
    result: "SUCCESS",
  });
  return json({ host: toPublicHost(host) });
});

export const DELETE = apiRoute("hosts.delete", async (_req, session, params) => {
  const host = await getHostOrThrow(params.id, session.user);
  await deleteHost(params.id, session.user);
  await writeAuditLog({
    userId: session.user.id,
    ip: await clientIp(),
    action: AUDIT_ACTIONS.HOST_DELETED,
    target: host.name,
    hostId: host.id,
    result: "SUCCESS",
  });
  return json({ ok: true });
});
