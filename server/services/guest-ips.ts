import { parseGuestConfigIps } from "@/lib/create-ip";
import type { ProxmoxClient } from "@/server/proxmox/client";
import type { GuestListItem } from "@/server/proxmox/types";

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
