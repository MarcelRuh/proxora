import { guestFilesystemUsage, parseGuestFsInfo } from "@/lib/disk-alerts";
import type { ProxmoxClient } from "@/server/proxmox/client";
import type { GuestListItem } from "@/server/proxmox/types";

const TTL_MS = 90_000;
const cache = new Map<string, { used: number; total: number; at: number }>();

function diskCacheKey(client: ProxmoxClient, node: string, vmid: number) {
  return `${client.http.baseUrl}:${node}:${vmid}`;
}

export function peekVmDiskCache(
  client: ProxmoxClient,
  node: string,
  vmid: number,
): { used: number; total: number } | null {
  const hit = cache.get(diskCacheKey(client, node, vmid));
  if (!hit || Date.now() - hit.at >= TTL_MS) return null;
  return { used: hit.used, total: hit.total };
}

export function clearVmDiskCache() {
  cache.clear();
}

/** Apply cached guest-agent usage without waiting on Proxmox. */
export function applyCachedVmDisks(client: ProxmoxClient, vms: GuestListItem[]): GuestListItem[] {
  return vms.map((vm) => {
    if (vm.status !== "running" || !vm.node || !vm.vmid || vm.template) return vm;
    const cached = peekVmDiskCache(client, vm.node, vm.vmid);
    if (!cached) return vm;
    return { ...vm, disk: cached.used, maxdisk: cached.total };
  });
}

export async function vmDiskFromAgent(
  client: ProxmoxClient,
  node: string,
  vmid: number,
): Promise<{ used: number; total: number } | null> {
  const hit = peekVmDiskCache(client, node, vmid);
  if (hit) return hit;
  const fs = await client.vms.agentFsInfo(node, vmid).catch(() => null);
  const usage = guestFilesystemUsage(parseGuestFsInfo(fs));
  if (!usage) return null;
  cache.set(diskCacheKey(client, node, vmid), { ...usage, at: Date.now() });
  return usage;
}

/** Cluster resources leave QEMU disk at 0; fill running VMs from the guest agent (cached). */
export async function attachVmAgentDisks(
  client: ProxmoxClient,
  vms: GuestListItem[],
  options?: { concurrency?: number; budgetMs?: number },
): Promise<GuestListItem[]> {
  const concurrency = Math.max(1, options?.concurrency ?? 6);
  const deadline = Date.now() + (options?.budgetMs ?? 3_500);
  const next = vms.map((vm) => ({ ...vm }));
  const running = next.filter((vm) => vm.status === "running" && vm.node && vm.vmid && !vm.template);

  const pending: GuestListItem[] = [];
  for (const vm of running) {
    const cached = peekVmDiskCache(client, vm.node, vm.vmid);
    if (cached) {
      vm.disk = cached.used;
      vm.maxdisk = cached.total;
    } else {
      pending.push(vm);
    }
  }

  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, pending.length) }, async () => {
      while (i < pending.length) {
        if (Date.now() > deadline) break;
        const vm = pending[i++];
        if (!vm) break;
        const usage = await vmDiskFromAgent(client, vm.node, vm.vmid).catch(() => null);
        if (usage) {
          vm.disk = usage.used;
          vm.maxdisk = usage.total;
        }
      }
    }),
  );
  return next;
}

export function isQemuAgentEnabled(config: Record<string, unknown> | undefined | null): boolean {
  const raw = config?.agent;
  if (raw === 1 || raw === "1") return true;
  const text = String(raw ?? "");
  return /(?:^|,)enabled=1(?:$|,)/.test(text) || text === "1";
}
