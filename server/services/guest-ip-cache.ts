import { parseAgentNetworkIps, parseGuestConfigIps, parseLxcInterfaceIps } from "@/lib/create-ip";
import { uniqueGuestIps } from "@/lib/guest-ip-display";
import type { ProxmoxClient } from "@/server/proxmox/client";
import type { GuestListItem } from "@/server/proxmox/types";

const TTL_FULL_MS = 10 * 60_000;
const TTL_EMPTY_MS = 20_000;
const cache = new Map<string, { ips: string[]; at: number }>();

function ipCacheKey(client: ProxmoxClient, kind: "vm" | "lxc", node: string, vmid: number) {
  return `${client.http.baseUrl}:${kind}:${node}:${vmid}`;
}

export function peekGuestIpCache(
  client: ProxmoxClient,
  kind: "vm" | "lxc",
  node: string,
  vmid: number,
): string[] | null {
  const hit = cache.get(ipCacheKey(client, kind, node, vmid));
  if (!hit) return null;
  const ttl = hit.ips.length ? TTL_FULL_MS : TTL_EMPTY_MS;
  if (Date.now() - hit.at >= ttl) {
    cache.delete(ipCacheKey(client, kind, node, vmid));
    return null;
  }
  return hit.ips;
}

export function rememberGuestIpCache(
  client: ProxmoxClient,
  kind: "vm" | "lxc",
  node: string,
  vmid: number,
  ips: string[],
) {
  cache.set(ipCacheKey(client, kind, node, vmid), { ips: uniqueGuestIps(ips), at: Date.now() });
}

export function clearGuestIpCache() {
  cache.clear();
}

export function applyCachedGuestIps(
  client: ProxmoxClient,
  kind: "vm" | "lxc",
  guests: GuestListItem[],
): GuestListItem[] {
  return guests.map((guest) => {
    if (!guest.node || !guest.vmid || guest.template) return guest;
    const cached = peekGuestIpCache(client, kind, guest.node, guest.vmid);
    if (!cached) return guest;
    return { ...guest, ips: cached };
  });
}

async function ipsFromGuest(
  client: ProxmoxClient,
  kind: "vm" | "lxc",
  guest: GuestListItem,
): Promise<string[] | null> {
  if (!guest.node || !guest.vmid) return null;
  const cached = peekGuestIpCache(client, kind, guest.node, guest.vmid);
  if (cached) return cached;
  const cfg =
    kind === "vm"
      ? await client.vms.config(guest.node, guest.vmid).catch(() => null)
      : await client.lxc.config(guest.node, guest.vmid).catch(() => null);
  if (!cfg) return null;
  let ips = parseGuestConfigIps(cfg);
  if (!ips.length && guest.status === "running") {
    if (kind === "vm") {
      const net = await client.vms.agentNetworkInterfaces(guest.node, guest.vmid).catch(() => null);
      ips = parseAgentNetworkIps(net);
    } else {
      const ifaces = await client.lxc.interfaces(guest.node, guest.vmid).catch(() => null);
      ips = parseLxcInterfaceIps(ifaces);
    }
  }
  rememberGuestIpCache(client, kind, guest.node, guest.vmid, ips);
  return ips;
}

/** Fill missing guest IPs from config (and QEMU agent / LXC interfaces when DHCP). */
export async function rememberGuestIps(
  client: ProxmoxClient,
  kind: "vm" | "lxc",
  guests: GuestListItem[],
  options?: { concurrency?: number; budgetMs?: number },
): Promise<GuestListItem[]> {
  const concurrency = Math.max(1, options?.concurrency ?? 8);
  const deadline = Date.now() + (options?.budgetMs ?? 8_000);
  const next = applyCachedGuestIps(client, kind, guests).map((guest) => ({ ...guest }));
  const pending = next.filter(
    (guest) => guest.node && guest.vmid && !guest.template && peekGuestIpCache(client, kind, guest.node, guest.vmid) === null,
  );
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, pending.length) }, async () => {
      while (i < pending.length) {
        if (Date.now() > deadline) break;
        const guest = pending[i++];
        if (!guest) break;
        const ips = await ipsFromGuest(client, kind, guest).catch(() => null);
        if (ips) guest.ips = ips;
      }
    }),
  );
  return next;
}
