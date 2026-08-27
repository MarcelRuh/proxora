import type { ProxmoxClient } from "@/server/proxmox/client";

export async function startGuestAfterCreate(
  client: ProxmoxClient,
  kind: "vm" | "lxc",
  node: string,
  vmid: number,
  upid: string | undefined,
): Promise<{ started: boolean; startError?: string }> {
  if (!upid) return { started: false };
  try {
    await client.tasks.wait(node, upid, 300_000);
    if (kind === "vm") await client.vms.start(node, vmid);
    else await client.lxc.start(node, vmid);
    return { started: true };
  } catch (error) {
    return { started: false, startError: error instanceof Error ? error.message : "Start failed" };
  }
}
