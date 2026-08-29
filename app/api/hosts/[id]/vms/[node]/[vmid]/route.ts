import { z } from "zod";
import { apiRoute } from "@/server/http/api-route";
import { json } from "@/server/http/respond";
import { clientIp } from "@/server/auth/session";
import { writeAuditLog } from "@/server/services/audit-service";
import { AUDIT_ACTIONS } from "@/lib/audit-actions";
import { notifyTopic } from "@/server/notifications/dispatch";
import { pickGuestName } from "@/server/notifications/guest-name";
import { hasPermission, permissionForGuestAction } from "@/lib/permissions";
import { ForbiddenError } from "@/lib/errors";
import { assertGuestAccess } from "@/server/auth/session-core";
import { assertGuestIdentityFree } from "@/server/services/guest-ips";
import { withHostClient } from "@/server/services/host-service";
import { waitGuestAction } from "@/server/proxmox/task-wait";
import { durationLabel } from "@/lib/duration";
import { notifyGuestTaskFailed } from "@/server/notifications/guest-task-fail";
import { invalidateGuestNoteCache } from "@/server/services/guest-notes";

export const maxDuration = 800;

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
  return permissionForGuestAction("vm", action);
}

export const GET = apiRoute("vm.view", async (_req, session, params) => {
  const vmid = Number(params.vmid);
  assertGuestAccess(session.user, params.id, "vm", vmid);
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
  if (!hasPermission(session.user.role.permissions, needed)) {
    throw new ForbiddenError();
  }
  if (["delete", "reset"].includes(body.action) && body.confirm !== true) {
    const { ValidationError } = await import("@/lib/errors");
    throw new ValidationError("Confirmation required");
  }
  const vmid = Number(params.vmid);
  assertGuestAccess(session.user, params.id, "vm", vmid);
  let hostName = "";
  let guestName: string | undefined;
  const t0 = Date.now();
  let upid: unknown;
  let taskUpid: unknown;
  try {
    upid = await withHostClient(params.id, session.user, async (client, host) => {
    hostName = host.name;
    const vm = client.vms;
    const node = params.node;
    if (body.action === "delete") {
      const status = await vm.status(node, vmid).catch(() => null);
      guestName = pickGuestName(status);
    }
    let result: unknown;
    switch (body.action) {
      case "start":
        result = await vm.start(node, vmid);
        break;
      case "stop":
        result = await vm.stop(node, vmid);
        break;
      case "shutdown":
        result = await vm.shutdown(node, vmid);
        break;
      case "reboot":
        result = await vm.reboot(node, vmid);
        break;
      case "reset":
        result = await vm.reset(node, vmid);
        break;
      case "pause":
        result = await vm.suspend(node, vmid);
        break;
      case "resume":
        result = await vm.resume(node, vmid);
        break;
      case "delete":
        result = await vm.delete(node, vmid);
        break;
      case "clone":
        if (body.newid) await assertGuestIdentityFree(body.newid);
        result = await vm.clone(node, vmid, { newid: body.newid, name: body.name, full: 1 });
        break;
      case "migrate":
        result = await vm.migrate(node, vmid, { target: body.target, online: 1 });
        break;
      case "snapshot":
        result = await vm.createSnapshot(node, vmid, body.snapname ?? `snap-${Date.now()}`, body.description);
        break;
      case "snapshot-delete":
        result = await vm.deleteSnapshot(node, vmid, body.snapname ?? "");
        break;
      case "snapshot-rollback":
        result = await vm.rollbackSnapshot(node, vmid, body.snapname ?? "");
        break;
      case "config":
        result = await vm.updateConfig(node, vmid, body.config ?? {});
        invalidateGuestNoteCache(client.http.baseUrl, "vm", node, vmid);
        break;
      default:
        result = null;
    }
    taskUpid = result;
    await waitGuestAction(client, node, result, body.action);
    return result;
    });
  } catch (error) {
    notifyGuestTaskFailed({
      kind: "vm",
      action: body.action,
      vmid,
      name: guestName,
      hostId: params.id,
      hostName,
      node: params.node,
      error,
      upid: taskUpid,
    });
    if (body.action === "delete") {
      notifyTopic("vm.deleted", {
        level: "error",
        title: "VM löschen fehlgeschlagen",
        message: `VM ${vmid}${guestName ? ` (${guestName})` : ""} — fehlgeschlagen: ${error instanceof Error ? error.message : "unbekannt"}`,
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
    target: `VM ${vmid}`,
    hostId: params.id,
    result: "SUCCESS",
    metadata: { upid: typeof upid === "string" ? upid : null, action: body.action },
  });
  if (body.action === "delete") {
    notifyTopic("vm.deleted", {
      level: "warning",
      title: "VM gelöscht",
      message: `VM ${vmid}${guestName ? ` (${guestName})` : ""} — fertig in ${durationLabel(Date.now() - t0)}`,
      hostId: params.id,
      name: guestName,
      id: String(vmid),
      host: hostName,
      node: params.node,
    });
  }
  return json({ upid });
});
