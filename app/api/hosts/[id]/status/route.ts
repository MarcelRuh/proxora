import { z } from "zod";
import { apiRoute } from "@/server/http/api-route";
import { json } from "@/server/http/respond";
import { clientIp } from "@/server/auth/session";
import { writeAuditLog } from "@/server/services/audit-service";
import { AUDIT_ACTIONS } from "@/lib/audit-actions";
import { withHostClient } from "@/server/services/host-service";
import { filterGuestsForUser } from "@/server/auth/session-core";
import { hasPermission } from "@/lib/permissions";
import { ForbiddenError } from "@/lib/errors";

const actionSchema = z.object({
  action: z.enum(["reboot", "shutdown"]),
  node: z.string().min(1),
  confirm: z.literal(true),
});

export const GET = apiRoute("hosts.view", async (_req, session, params) => {
  const data = await withHostClient(params.id, session.user, async (client, host) => {
    const nodes = await client.nodes.list();
    const details = await Promise.all(
      nodes.map(async (n) => {
        const status = await client.nodes.status(n.node).catch(() => null);
        return { ...n, status };
      }),
    );
    const [vms, containers, storage] = await Promise.all([
      client.listVms().catch(() => []),
      client.listContainers().catch(() => []),
      client.storage.list(nodes[0]?.node).catch(() => []),
    ]);
    return {
      host: host.name,
      nodes: details,
      vms: filterGuestsForUser(session.user, params.id, "vm", vms),
      containers: filterGuestsForUser(session.user, params.id, "lxc", containers),
      storage,
    };
  });
  return json(data);
});

export const POST = apiRoute(["hosts.reboot", "hosts.shutdown"], async (req, session, params) => {
  const body = actionSchema.parse(await req.json());
  const needed = body.action === "reboot" ? "hosts.reboot" : "hosts.shutdown";
  if (!hasPermission(session.user.role.permissions, needed)) throw new ForbiddenError();
  const upid = await withHostClient(params.id, session.user, async (client) => {
    if (body.action === "reboot") return client.nodes.reboot(body.node);
    return client.nodes.shutdown(body.node);
  });
  await writeAuditLog({
    userId: session.user.id,
    ip: await clientIp(),
    action: body.action === "reboot" ? AUDIT_ACTIONS.HOST_REBOOT : AUDIT_ACTIONS.HOST_SHUTDOWN,
    target: body.node,
    hostId: params.id,
    result: "SUCCESS",
    metadata: { upid },
  });
  return json({ upid });
});
