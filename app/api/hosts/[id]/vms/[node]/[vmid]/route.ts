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
    "reset",
    "pause",
    "resume",
    "delete",
    "clone",
    "migrate",
    "snapshot",
    "snapshot-delete",
    "snapshot-rollback",
    "config",
  ]),
  confirm: z.boolean().optional(),
  newid: z.number().int().positive().optional(),
  name: z.string().optional(),
  target: z.string().optional(),
  snapname: z.string().optional(),
  description: z.string().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});

const ACTION_AUDIT: Record<string, string> = {
  start: AUDIT_ACTIONS.VM_STARTED,
  stop: AUDIT_ACTIONS.VM_STOPPED,
  shutdown: AUDIT_ACTIONS.VM_SHUTDOWN,
  reboot: AUDIT_ACTIONS.VM_REBOOT,
  reset: AUDIT_ACTIONS.VM_RESET,
  pause: AUDIT_ACTIONS.VM_PAUSED,
  resume: AUDIT_ACTIONS.VM_RESUMED,
  delete: AUDIT_ACTIONS.VM_DELETED,
  clone: AUDIT_ACTIONS.VM_CLONED,
  migrate: AUDIT_ACTIONS.VM_MIGRATED,
  snapshot: AUDIT_ACTIONS.VM_SNAPSHOT_CREATED,
  "snapshot-delete": AUDIT_ACTIONS.VM_SNAPSHOT_DELETED,
  "snapshot-rollback": AUDIT_ACTIONS.VM_SNAPSHOT_RESTORED,
  config: AUDIT_ACTIONS.VM_CONFIG_UPDATED,
};

function permissionFor(action: string) {
  if (["start", "stop", "shutdown", "reboot", "reset", "pause", "resume"].includes(action)) {
    return action === "start" ? ("vm.start" as const) : ("vm.stop" as const);
  }
  if (action === "delete") return "vm.delete" as const;
  if (action === "clone") return "vm.clone" as const;
  if (action === "migrate") return "vm.migrate" as const;
  if (action.startsWith("snapshot")) return "vm.snapshot" as const;
  return "vm.edit" as const;
}

export const GET = apiRoute("vm.view", async (_req, session, params) => {
  const vmid = Number(params.vmid);
  const data = await withHostClient(params.id, session.user, async (client) => {
    const [status, config, snapshots] = await Promise.all([
      client.vms.status(params.node, vmid),
      client.vms.config(params.node, vmid),
      client.vms.snapshots(params.node, vmid).catch(() => []),
    ]);
    return { status, config, snapshots };
  });
  return json(data);
});

export const POST = apiRoute("vm.view", async (req, session, params) => {
  const body = actionSchema.parse(await req.json());
  const needed = permissionFor(body.action);
  if (!session.user.role.permissions.includes(needed)) {
    const { ForbiddenError } = await import("@/lib/errors");
    throw new ForbiddenError();
  }
  if (["delete", "reset"].includes(body.action) && body.confirm !== true) {
    const { ValidationError } = await import("@/lib/errors");
    throw new ValidationError("Confirmation required");
  }
  const vmid = Number(params.vmid);
  let hostName = "";
  let guestName: string | undefined;
  const upid = await withHostClient(params.id, session.user, async (client, host) => {
    hostName = host.name;
    const vm = client.vms;
    const node = params.node;
    if (body.action === "delete") {
      const status = await vm.status(node, vmid).catch(() => null);
      guestName = pickGuestName(status);
    }
    switch (body.action) {
      case "start":
        return vm.start(node, vmid);
      case "stop":
        return vm.stop(node, vmid);
      case "shutdown":
        return vm.shutdown(node, vmid);
      case "reboot":
        return vm.reboot(node, vmid);
      case "reset":
        return vm.reset(node, vmid);
      case "pause":
        return vm.suspend(node, vmid);
      case "resume":
        return vm.resume(node, vmid);
      case "delete":
        return vm.delete(node, vmid);
      case "clone":
        return vm.clone(node, vmid, { newid: body.newid, name: body.name, full: 1 });
      case "migrate":
        return vm.migrate(node, vmid, { target: body.target, online: 1 });
      case "snapshot":
        return vm.createSnapshot(node, vmid, body.snapname ?? `snap-${Date.now()}`, body.description);
      case "snapshot-delete":
        return vm.deleteSnapshot(node, vmid, body.snapname ?? "");
      case "snapshot-rollback":
        return vm.rollbackSnapshot(node, vmid, body.snapname ?? "");
      case "config":
        return vm.updateConfig(node, vmid, body.config ?? {});
      default:
        return null;
    }
  });
  await writeAuditLog({
    userId: session.user.id,
    ip: await clientIp(),
    action: ACTION_AUDIT[body.action],
    target: `VM ${vmid}`,
    hostId: params.id,
    result: "SUCCESS",
    metadata: { upid, action: body.action },
  });
  if (body.action === "delete") {
    notifyTopic("vm.deleted", {
      level: "warning",
      title: "VM gelöscht",
      message: `VM ${vmid}${guestName ? ` (${guestName})` : ""} auf ${params.node}`,
      hostId: params.id,
      name: guestName,
      id: String(vmid),
      host: hostName,
      node: params.node,
    });
  }
  return json({ upid });
});
