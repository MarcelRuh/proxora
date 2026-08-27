import { z } from "zod";
import { apiRoute } from "@/server/http/api-route";
import { json } from "@/server/http/respond";
import { clientIp } from "@/server/auth/session";
import { writeAuditLog } from "@/server/services/audit-service";
import { AUDIT_ACTIONS } from "@/lib/audit-actions";
import { notifyTopic } from "@/server/notifications/dispatch";
import { pickGuestName } from "@/server/notifications/guest-name";
import { withHostClient } from "@/server/services/host-service";

const actionSchema = z.object({
  action: z.enum([
    "start",
    "stop",
    "shutdown",
    "reboot",
    "delete",
    "clone",
    "snapshot",
    "snapshot-delete",
    "snapshot-rollback",
    "config",
  ]),
  confirm: z.boolean().optional(),
  newid: z.number().int().positive().optional(),
  hostname: z.string().optional(),
  snapname: z.string().optional(),
  description: z.string().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});

const ACTION_AUDIT: Record<string, string> = {
  start: AUDIT_ACTIONS.LXC_STARTED,
  stop: AUDIT_ACTIONS.LXC_STOPPED,
  shutdown: AUDIT_ACTIONS.LXC_SHUTDOWN,
  reboot: AUDIT_ACTIONS.LXC_REBOOT,
  delete: AUDIT_ACTIONS.LXC_DELETED,
  clone: AUDIT_ACTIONS.LXC_CLONED,
  snapshot: AUDIT_ACTIONS.LXC_SNAPSHOT_CREATED,
  "snapshot-delete": AUDIT_ACTIONS.LXC_SNAPSHOT_DELETED,
  "snapshot-rollback": AUDIT_ACTIONS.LXC_SNAPSHOT_RESTORED,
  config: AUDIT_ACTIONS.LXC_CONFIG_UPDATED,
};

export const GET = apiRoute("lxc.view", async (_req, session, params) => {
  const vmid = Number(params.vmid);
  const data = await withHostClient(params.id, session.user, async (client) => {
    const [status, config, snapshots] = await Promise.all([
      client.lxc.status(params.node, vmid),
      client.lxc.config(params.node, vmid),
      client.lxc.snapshots(params.node, vmid).catch(() => []),
    ]);
    return { status, config, snapshots };
  });
  return json(data);
});

export const POST = apiRoute("lxc.view", async (req, session, params) => {
  const body = actionSchema.parse(await req.json());
  if (body.action === "delete" && body.confirm !== true) {
    const { ValidationError } = await import("@/lib/errors");
    throw new ValidationError("Confirmation required");
  }
  const vmid = Number(params.vmid);
  let hostName = "";
  let guestName: string | undefined;
  const upid = await withHostClient(params.id, session.user, async (client, host) => {
    hostName = host.name;
    const node = params.node;
    if (body.action === "delete") {
      const status = await client.lxc.status(node, vmid).catch(() => null);
      guestName = pickGuestName(status);
    }
    switch (body.action) {
      case "start":
        return client.lxc.start(node, vmid);
      case "stop":
        return client.lxc.stop(node, vmid);
      case "shutdown":
        return client.lxc.shutdown(node, vmid);
      case "reboot":
        return client.lxc.reboot(node, vmid);
      case "delete":
        return client.lxc.delete(node, vmid);
      case "clone":
        return client.lxc.clone(node, vmid, { newid: body.newid, hostname: body.hostname });
      case "snapshot":
        return client.lxc.createSnapshot(node, vmid, body.snapname ?? `snap-${Date.now()}`, body.description);
      case "snapshot-delete":
        return client.lxc.deleteSnapshot(node, vmid, body.snapname ?? "");
      case "snapshot-rollback":
        return client.lxc.rollbackSnapshot(node, vmid, body.snapname ?? "");
      case "config":
        return client.lxc.updateConfig(node, vmid, body.config ?? {});
      default:
        return null;
    }
  });
  await writeAuditLog({
    userId: session.user.id,
    ip: await clientIp(),
    action: ACTION_AUDIT[body.action],
    target: `LXC ${vmid}`,
    hostId: params.id,
    result: "SUCCESS",
    metadata: { upid },
  });
  if (body.action === "delete") {
    notifyTopic("lxc.deleted", {
      level: "warning",
      title: "Container gelöscht",
      message: `LXC ${vmid}${guestName ? ` (${guestName})` : ""} auf ${params.node}`,
      hostId: params.id,
      name: guestName,
      id: String(vmid),
      host: hostName,
      node: params.node,
    });
  }
  return json({ upid });
});
