import { z } from "zod";
import { apiRoute } from "@/server/http/api-route";
import { json } from "@/server/http/respond";
import { clientIp } from "@/server/auth/session";
import { writeAuditLog } from "@/server/services/audit-service";
import { AUDIT_ACTIONS } from "@/lib/audit-actions";
import { withHostClient, assertLocalHost } from "@/server/services/host-service";
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
    const [nodeResources, guests, storage] = await Promise.all([
      client.listResources("node"),
      client.listGuests().catch(() => ({ vms: [], containers: [] })),
      client.storage.list().catch(() => []),
    ]);
    const details = nodeResources
      .filter((n) => n.node)
      .map((n) => ({
        node: n.node as string,
        online: n.status ?? "unknown",
        status: {
          cpu: n.cpu ?? 0,
          memory: { used: n.mem ?? 0, total: n.maxmem ?? 0 },
          rootfs: { used: n.disk ?? 0, total: n.maxdisk ?? 0 },
          uptime: n.uptime ?? 0,
        },
      }));
    return {
      host: host.name,
      nodes: details,
      vms: filterGuestsForUser(session.user, params.id, "vm", guests.vms),
      containers: filterGuestsForUser(session.user, params.id, "lxc", guests.containers),
      storage,
    };
  });
  return json(data);
});

export const POST = apiRoute(["hosts.reboot", "hosts.shutdown"], async (req, session, params) => {
  const body = actionSchema.parse(await req.json());
  const needed = body.action === "reboot" ? "hosts.reboot" : "hosts.shutdown";
  if (!hasPermission(session.user.role.permissions, needed)) throw new ForbiddenError();
  const upid = await withHostClient(params.id, session.user, async (client, host) => {
    assertLocalHost(host);
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
