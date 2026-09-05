import { apiRoute } from "@/server/http/api-route";
import { json } from "@/server/http/respond";
import { clientIp } from "@/server/auth/session";
import { writeAuditLog } from "@/server/services/audit-service";
import { AUDIT_ACTIONS } from "@/lib/audit-actions";
import { hasPermission } from "@/lib/permissions";
import { ForbiddenError } from "@/lib/errors";
import { prisma } from "@/lib/db";
import {
  deleteHost,
  getHostOrThrow,
  hostUpdateSchema,
  toPublicHost,
  updateHost,
} from "@/server/services/host-service";

export const GET = apiRoute("hosts.view", async (_req, session, params) => {
  const host = await getHostOrThrow(params.id, session.user);
  const peer = host.peerId
    ? await prisma.wireguardPeer.findUnique({ where: { id: host.peerId }, select: { name: true } })
    : null;
  return json({ host: toPublicHost({ ...host, peer }) });
});

export const PATCH = apiRoute(["hosts.update", "hosts.credentials"], async (req, session, params) => {
  const body = hostUpdateSchema.parse(await req.json());
  const creds = Boolean(body.secret || body.authType || body.username || body.tokenId);
  const meta =
    body.name !== undefined ||
    body.url !== undefined ||
    body.notes !== undefined ||
    body.allowInsecureTls !== undefined;
  if (creds && !hasPermission(session.user.role.permissions, "hosts.credentials")) throw new ForbiddenError();
  if (meta && !hasPermission(session.user.role.permissions, "hosts.update")) throw new ForbiddenError();
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
