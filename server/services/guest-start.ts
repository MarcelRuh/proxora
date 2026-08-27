import { TASK_TIMEOUT, waitUpid } from "@/server/proxmox/task-wait";
import type { ProxmoxClient } from "@/server/proxmox/client";

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
