import { parseGuestConfigIps } from "@/lib/create-ip";
import { prisma } from "@/lib/db";
import { ConflictError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { mergeUsedGuestSets } from "@/lib/next-vmid";
import type { ProxmoxClient } from "@/server/proxmox/client";
import type { GuestListItem } from "@/server/proxmox/types";
import { clientForHost } from "@/server/services/host-service";

export async function collectUsedGuestIps(client: ProxmoxClient): Promise<{ vmids: number[]; ips: string[] }> {
  const guests = await client.listGuests().catch(() => ({ vms: [] as GuestListItem[], containers: [] as GuestListItem[] }));
  const listed = [
    ...guests.vms.map((g) => ({ kind: "vm" as const, ...g })),
    ...guests.containers.map((g) => ({ kind: "lxc" as const, ...g })),
  ];
  const vmids = listed.map((g) => g.vmid).filter((id) => Number.isInteger(id) && id > 0);
  const ips = new Set<string>();
  if (listed.length === 0) return { vmids, ips: [] };

  let i = 0;
  const workers = Array.from({ length: Math.min(6, listed.length) }, async () => {
    while (i < listed.length) {
      const g = listed[i++];
      if (!g?.node || !g.vmid) continue;
      const cfg =
        g.kind === "vm"
          ? await client.vms.config(g.node, g.vmid).catch(() => null)
          : await client.lxc.config(g.node, g.vmid).catch(() => null);
      if (!cfg) continue;
      for (const ip of parseGuestConfigIps(cfg)) ips.add(ip);
    }
  });
  await Promise.all(workers);
  return { vmids, ips: [...ips] };
}

/** VMIDs and guest IPs from every Proxora host so new IDs stay unique lab-wide. */
export async function collectUsedGuestIpsAllHosts(): Promise<{ vmids: number[]; ips: string[] }> {
  const hosts = await prisma.host.findMany({ orderBy: { name: "asc" } });
  const parts = await Promise.all(
    hosts.map(async (host) => {
      try {
        const client = await clientForHost(host);
        return await collectUsedGuestIps(client);
      } catch (error) {
        logger.warn(
          { host: host.name, err: error instanceof Error ? error.message : String(error) },
          "Skipping host while collecting used guest IDs",
        );
        return { vmids: [] as number[], ips: [] as string[] };
      }
    }),
  );
  return mergeUsedGuestSets(parts);
}

export async function assertGuestIdentityFree(vmid: number, ip?: string | null) {
  const used = await collectUsedGuestIpsAllHosts();
  if (used.vmids.includes(vmid)) {
    throw new ConflictError(`VMID ${vmid} ist bereits vergeben`);
  }
  if (ip && used.ips.includes(ip)) {
    throw new ConflictError(`IPv4 ${ip} ist bereits vergeben`);
  }
}
