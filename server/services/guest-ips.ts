import { parseGuestConfigIps } from "@/lib/create-ip";
import { peekGuestIpCache, rememberGuestIpCache } from "@/server/services/guest-ip-cache";
import { hostsInGuestIdentityScope, identityConflict } from "@/lib/guest-identity";
import { prisma } from "@/lib/db";
import { ConflictError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { mergeUsedGuestSets } from "@/lib/next-vmid";
import type { ProxmoxClient } from "@/server/proxmox/client";
import type { GuestListItem } from "@/server/proxmox/types";
import { clientForHost } from "@/server/services/host-service";
import { loadHostInventory } from "@/server/services/inventory-cache";
import { HostOrigin, type Host } from "@prisma/client";

async function listedGuests(client: ProxmoxClient, hostId: string) {
  const guests = await loadHostInventory(client, hostId).catch(() => ({
    vms: [] as GuestListItem[],
    containers: [] as GuestListItem[],
  }));
  return [
    ...guests.vms.map((g) => ({ kind: "vm" as const, ...g })),
    ...guests.containers.map((g) => ({ kind: "lxc" as const, ...g })),
  ];
}

export async function collectUsedVmids(client: ProxmoxClient, hostId: string): Promise<number[]> {
  return listedGuests(client, hostId).then((listed) =>
    listed.map((g) => g.vmid).filter((id) => Number.isInteger(id) && id > 0),
  );
}

export async function collectUsedGuestIps(
  client: ProxmoxClient,
  hostId: string,
): Promise<{ vmids: number[]; ips: string[] }> {
  const listed = await listedGuests(client, hostId);
  const vmids = listed.map((g) => g.vmid).filter((id) => Number.isInteger(id) && id > 0);
  const ips = new Set<string>();
  const pending = listed.filter((g) => g.node && g.vmid && !g.template);
  if (pending.length === 0) return { vmids, ips: [] };

  const missing: typeof pending = [];
  for (const g of pending) {
    const cached = peekGuestIpCache(client, g.kind, g.node, g.vmid);
    if (cached) {
      for (const ip of cached) ips.add(ip);
    } else {
      missing.push(g);
    }
  }

  let i = 0;
  const workers = Array.from({ length: Math.min(4, missing.length) }, async () => {
    while (i < missing.length) {
      const g = missing[i++];
      if (!g?.node || !g.vmid) continue;
      const cfg =
        g.kind === "vm"
          ? await client.vms.config(g.node, g.vmid).catch(() => null)
          : await client.lxc.config(g.node, g.vmid).catch(() => null);
      if (!cfg) continue;
      const found = parseGuestConfigIps(cfg);
      rememberGuestIpCache(client, g.kind, g.node, g.vmid, found);
      for (const ip of found) ips.add(ip);
    }
  });
  await Promise.all(workers);
  return { vmids, ips: [...ips] };
}

async function forEachHostInScope<T>(
  target: Host,
  fn: (client: ProxmoxClient, hostId: string) => Promise<T>,
  empty: T,
): Promise<T[]> {
  const all = await prisma.host.findMany({ orderBy: { name: "asc" } });
  const scopedIds = new Set(
    hostsInGuestIdentityScope(
      { id: target.id, origin: target.origin === HostOrigin.PEER ? "PEER" : "LOCAL" },
      all.map((h) => ({ id: h.id, origin: h.origin === HostOrigin.PEER ? "PEER" : "LOCAL" })),
    ).map((h) => h.id),
  );
  const hosts = all.filter((h) => scopedIds.has(h.id));
  return Promise.all(
    hosts.map(async (host) => {
      try {
        const client = await clientForHost(host);
        return await fn(client, host.id);
      } catch (error) {
        logger.warn(
          { host: host.name, err: error instanceof Error ? error.message : String(error) },
          "Skipping host while collecting used guest IDs",
        );
        return empty;
      }
    }),
  );
}

export async function collectUsedVmidsForHost(target: Host): Promise<number[]> {
  const parts = await forEachHostInScope(target, (client, hostId) => collectUsedVmids(client, hostId), [] as number[]);
  return mergeUsedGuestSets(parts.map((vmids) => ({ vmids }))).vmids;
}

/** VMIDs and guest IPs in the create-target scope (local lab or one colleague cluster). */
export async function collectUsedGuestIpsForHost(target: Host): Promise<{ vmids: number[]; ips: string[] }> {
  const parts = await forEachHostInScope(
    target,
    (client, hostId) => collectUsedGuestIps(client, hostId),
    { vmids: [] as number[], ips: [] as string[] },
  );
  return mergeUsedGuestSets(parts);
}

export async function assertGuestIdentityFree(host: Host, vmid: number, ip?: string | null) {
  const used = ip
    ? await collectUsedGuestIpsForHost(host)
    : { vmids: await collectUsedVmidsForHost(host), ips: [] as string[] };
  const conflict = identityConflict(used, vmid, ip);
  if (conflict === "vmid") throw new ConflictError(`VMID ${vmid} ist bereits vergeben`);
  if (conflict === "ip") throw new ConflictError(`IPv4 ${ip} ist bereits vergeben`);
}
