import type { ProxmoxClient } from "@/server/proxmox/client";
import { configReferencesVolume, type VolumeUser } from "@/lib/volume-usage";

export async function collectVolumeUsers(
  client: ProxmoxClient,
  volids: string[],
): Promise<Record<string, VolumeUser[]>> {
  const unique = [...new Set(volids.filter(Boolean))];
  const out: Record<string, VolumeUser[]> = Object.fromEntries(unique.map((volid) => [volid, []]));
  if (!unique.length) return out;

  const { vms, containers } = await client.listGuests();
  const jobs = [
    ...vms.map((guest) => ({ kind: "vm" as const, guest, fetch: () => client.vms.config(guest.node, guest.vmid) })),
    ...containers.map((guest) => ({
      kind: "lxc" as const,
      guest,
      fetch: () => client.lxc.config(guest.node, guest.vmid),
    })),
  ];
  const rows = await Promise.all(
    jobs.map(async (job) => ({
      kind: job.kind,
      guest: job.guest,
      config: await job.fetch().catch(() => null),
    })),
  );

  for (const row of rows) {
    if (!row.config || !row.guest.vmid) continue;
    for (const volid of unique) {
      if (!configReferencesVolume(row.config, volid)) continue;
      out[volid]!.push({
        kind: row.kind,
        vmid: row.guest.vmid,
        name: row.guest.name,
        node: row.guest.node,
      });
    }
  }
  return out;
}
