import type { ProxmoxClient } from "@/server/proxmox/client";
import { mapPool } from "@/lib/async-pool";
import { configReferencesVolume, vmidFromVolid, type VolumeUser } from "@/lib/volume-usage";
import { loadHostInventory } from "@/server/services/inventory-cache";

export const VOLUME_USER_CONCURRENCY = 4;

export type VolumeUserKind = "vm" | "lxc" | "all";

export async function collectVolumeUsers(
  client: ProxmoxClient,
  hostId: string,
  volids: string[],
  options?: { kind?: VolumeUserKind },
): Promise<Record<string, VolumeUser[]>> {
  const unique = [...new Set(volids.filter(Boolean))];
  const out: Record<string, VolumeUser[]> = Object.fromEntries(unique.map((volid) => [volid, []]));
  if (!unique.length) return out;

  const { vms, containers } = await loadHostInventory(client, hostId);
  const kind = options?.kind ?? "all";
  let guests = [
    ...(kind !== "lxc" ? vms.map((guest) => ({ kind: "vm" as const, guest })) : []),
    ...(kind !== "vm" ? containers.map((guest) => ({ kind: "lxc" as const, guest })) : []),
  ].filter(({ guest }) => !guest.template && guest.vmid && guest.node);

  const encoded = unique.map(vmidFromVolid);
  if (encoded.length && encoded.every((id): id is number => id != null)) {
    const want = new Set(encoded);
    guests = guests.filter(({ guest }) => want.has(guest.vmid));
  }

  await mapPool(guests, VOLUME_USER_CONCURRENCY, async ({ kind: guestKind, guest }) => {
    const config =
      guestKind === "vm"
        ? await client.vms.config(guest.node, guest.vmid).catch(() => null)
        : await client.lxc.config(guest.node, guest.vmid).catch(() => null);
    if (!config) return;
    for (const volid of unique) {
      if (!configReferencesVolume(config, volid)) continue;
      out[volid]!.push({
        kind: guestKind,
        vmid: guest.vmid,
        name: guest.name,
        node: guest.node,
      });
    }
  });
  return out;
}
