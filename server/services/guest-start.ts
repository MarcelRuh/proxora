import { TASK_TIMEOUT, isUpid, waitUpid } from "@/server/proxmox/task-wait";
import type { ProxmoxClient } from "@/server/proxmox/client";
import { writeAuditLog } from "@/server/services/audit-service";
import { notifyTopic } from "@/server/notifications/dispatch";
import { durationLabel } from "@/lib/duration";

export function followGuestCreateTask(input: {
  client: ProxmoxClient;
  kind: "vm" | "lxc";
  node: string;
  vmid: number;
  name: string;
  hostId: string;
  hostName: string;
  upid: unknown;
  userId: string;
  ip: string | null | undefined;
  auditAction: string;
}) {
  const t0 = Date.now();
  const topic = input.kind === "lxc" ? "lxc.created" : "vm.created";
  const label = input.kind === "lxc" ? "Container" : "VM";
  const upid = isUpid(input.upid) ? input.upid : null;
  void (async () => {
    try {
      await waitUpid(input.client, input.node, input.upid, TASK_TIMEOUT.create);
      await writeAuditLog({
        userId: input.userId,
        ip: input.ip,
        action: input.auditAction,
        target: `${input.vmid} ${input.name}`,
        hostId: input.hostId,
        result: "SUCCESS",
        metadata: { upid, pending: false },
      });
      notifyTopic(topic, {
        level: "success",
        title: `${label} erstellt`,
        message: `${input.kind === "lxc" ? "LXC" : "VM"} ${input.vmid} (${input.name}) — fertig in ${durationLabel(Date.now() - t0)}`,
        hostId: input.hostId,
        name: input.name,
        id: String(input.vmid),
        host: input.hostName,
        node: input.node,
      });
    } catch (error) {
      notifyTopic(topic, {
        level: "error",
        title: `${label} fehlgeschlagen`,
        message: `${input.kind === "lxc" ? "LXC" : "VM"} ${input.vmid} (${input.name}) — fehlgeschlagen: ${error instanceof Error ? error.message : "unbekannt"}`,
        hostId: input.hostId,
        name: input.name,
        id: String(input.vmid),
        host: input.hostName,
        node: input.node,
      });
    }
  })();
}

export async function completeGuestCreate(
  client: ProxmoxClient,
  kind: "vm" | "lxc",
  node: string,
  vmid: number,
  createUpid: unknown,
  startAfter: boolean,
): Promise<{ started: boolean; startError?: string; durationMs: number }> {
  const t0 = Date.now();
  await waitUpid(client, node, createUpid, TASK_TIMEOUT.create);
  if (!startAfter) return { started: false, durationMs: Date.now() - t0 };
  try {
    const startUpid = kind === "vm" ? await client.vms.start(node, vmid) : await client.lxc.start(node, vmid);
    await waitUpid(client, node, startUpid, TASK_TIMEOUT.start);
    return { started: true, durationMs: Date.now() - t0 };
  } catch (error) {
    return {
      started: false,
      startError: error instanceof Error ? error.message : "Start failed",
      durationMs: Date.now() - t0,
    };
  }
}

/** @deprecated use completeGuestCreate */
export async function startGuestAfterCreate(
  client: ProxmoxClient,
  kind: "vm" | "lxc",
  node: string,
  vmid: number,
  upid: string | undefined,
): Promise<{ started: boolean; startError?: string }> {
  const result = await completeGuestCreate(client, kind, node, vmid, upid, true);
  return { started: result.started, startError: result.startError };
}
