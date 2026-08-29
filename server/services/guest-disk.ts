import { guestFilesystemUsage, parseGuestFsInfo } from "@/lib/disk-alerts";
import type { ProxmoxClient } from "@/server/proxmox/client";
import type { GuestListItem } from "@/server/proxmox/types";

const TTL_MS = 30_000;
const cache = new Map<string, { used: number; total: number; at: number }>();

export async function vmDiskFromAgent(
  client: ProxmoxClient,
  node: string,
  vmid: number,
): Promise<{ used: number; total: number } | null> {
  const key = `${client.http.baseUrl}:${node}:${vmid}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return { used: hit.used, total: hit.total };
  const fs = await client.vms.agentFsInfo(node, vmid).catch(() => null);
  const usage = guestFilesystemUsage(parseGuestFsInfo(fs));
  if (!usage) return null;
  cache.set(key, { ...usage, at: Date.now() });
  return usage;
}

export async function fillVmDisksFromAgent(client: ProxmoxClient, vms: GuestListItem[]): Promise<void> {
  await Promise.all(
    vms.map(async (vm) => {
      if (vm.template || vm.status !== "running" || !vm.node || !vm.vmid) return;
      const usage = await vmDiskFromAgent(client, vm.node, vm.vmid).catch(() => null);
      if (!usage) return;
      vm.disk = usage.used;
      vm.maxdisk = usage.total;
    }),
  );
}

export function isQemuAgentEnabled(config: Record<string, unknown> | undefined | null): boolean {
  const raw = config?.agent;
  if (raw === 1 || raw === "1") return true;
  const text = String(raw ?? "");
  return /(?:^|,)enabled=1(?:$|,)/.test(text) || text === "1";
}
