import { z } from "zod";
import { apiRoute } from "@/server/http/api-route";
import { json } from "@/server/http/respond";
import { clientIp } from "@/server/auth/session";
import { writeAuditLog } from "@/server/services/audit-service";
import { AUDIT_ACTIONS } from "@/lib/audit-actions";
import { notifyTopic } from "@/server/notifications/dispatch";
import { pickGuestName } from "@/server/notifications/guest-name";
import { permissionForGuestAction, hasPermission } from "@/lib/permissions";
import { ForbiddenError } from "@/lib/errors";
import { assertGuestAccess } from "@/server/auth/session-core";
import { withHostClient } from "@/server/services/host-service";
import { waitGuestAction } from "@/server/proxmox/task-wait";
import { durationLabel } from "@/lib/duration";

export const maxDuration = 800;

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
  assertGuestAccess(session.user, params.id, "lxc", vmid);
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
  const needed = permissionForGuestAction("lxc", body.action);
  if (!hasPermission(session.user.role.permissions, needed)) {
    throw new ForbiddenError();
  }
  if (body.action === "delete" && body.confirm !== true) {
    const { ValidationError } = await import("@/lib/errors");
    throw new ValidationError("Confirmation required");
  }
  const vmid = Number(params.vmid);
  assertGuestAccess(session.user, params.id, "lxc", vmid);
  let hostName = "";
  let guestName: string | undefined;
  const t0 = Date.now();
  let upid: unknown;
  try {
    upid = await withHostClient(params.id, session.user, async (client, host) => {
      hostName = host.name;
      const node = params.node;
      if (body.action === "delete") {
        const status = await client.lxc.status(node, vmid).catch(() => null);
        guestName = pickGuestName(status);
      }
      let result: unknown;
      switch (body.action) {
        case "start":
          result = await client.lxc.start(node, vmid);
          break;
        case "stop":
          result = await client.lxc.stop(node, vmid);
          break;
        case "shutdown":
          result = await client.lxc.shutdown(node, vmid);
          break;
        case "reboot":
          result = await client.lxc.reboot(node, vmid);
          break;
        case "delete":
          result = await client.lxc.delete(node, vmid);
          break;
        case "clone":
          result = await client.lxc.clone(node, vmid, { newid: body.newid, hostname: body.hostname });
          break;
        case "snapshot":
          result = await client.lxc.createSnapshot(node, vmid, body.snapname ?? `snap-${Date.now()}`, body.description);
          break;
        case "snapshot-delete":
          result = await client.lxc.deleteSnapshot(node, vmid, body.snapname ?? "");
          break;
        case "snapshot-rollback":
          result = await client.lxc.rollbackSnapshot(node, vmid, body.snapname ?? "");
          break;
        case "config":
          result = await client.lxc.updateConfig(node, vmid, body.config ?? {});
          break;
        default:
          result = null;
      }
      await waitGuestAction(client, node, result, body.action);
      return result;
    });
  } catch (error) {
    if (body.action === "delete") {
      notifyTopic("lxc.deleted", {
        level: "error",
        title: "Container löschen fehlgeschlagen",
        message: `LXC ${vmid}${guestName ? ` (${guestName})` : ""} — fehlgeschlagen: ${error instanceof Error ? error.message : "unbekannt"}`,
        hostId: params.id,
        name: guestName,
        id: String(vmid),
        host: hostName,
        node: params.node,
      });
    }
    throw error;
  }
  await writeAuditLog({
    userId: session.user.id,
    ip: await clientIp(),
    action: ACTION_AUDIT[body.action],
    target: `LXC ${vmid}`,
    hostId: params.id,
    result: "SUCCESS",
    metadata: { upid: typeof upid === "string" ? upid : null },
  });
  if (body.action === "delete") {
    notifyTopic("lxc.deleted", {
      level: "warning",
      title: "Container gelöscht",
      message: `LXC ${vmid}${guestName ? ` (${guestName})` : ""} — fertig in ${durationLabel(Date.now() - t0)}`,
      hostId: params.id,
      name: guestName,
      id: String(vmid),
      host: hostName,
      node: params.node,
    });
  }
  return json({ upid });
});
