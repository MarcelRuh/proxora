import type { ProxmoxClient } from "@/server/proxmox/client";
import { isIsoRow } from "@/lib/iso-images";
import { isVztmplRow, storageContentVolid } from "@/lib/lxc-templates";
import { applyVolumeUsage, normalizeStorageContentRow, type StorageContentItem } from "@/lib/storage-content";

export async function collectStorageVolumes(
  client: ProxmoxClient,
  nodes: string[],
  content: "vztmpl" | "iso",
): Promise<{ storages: string[]; volids: string[] }> {
  const match = content === "iso" ? isIsoRow : isVztmplRow;
  const storages = new Set<string>();
  const seen = new Set<string>();
  const volids: string[] = [];
  await Promise.all(
    nodes.map(async (node) => {
      const list = await client.storage.list(node).catch(() => []);
      const eligible = list.filter((s) => (s.content ?? "").includes(content));
      for (const s of eligible) storages.add(s.storage);
      await Promise.all(
        eligible.map(async (s) => {
          let rows = await client.storage.content(node, s.storage, content).catch(() => []);
          if (!rows.length) {
            rows = (await client.storage.content(node, s.storage).catch(() => [])).filter((row) =>
              match(row as Record<string, unknown>),
            );
          }
          for (const row of rows) {
            const volid = storageContentVolid(row as Record<string, unknown>);
            if (!volid || seen.has(volid)) continue;
            seen.add(volid);
            volids.push(volid);
          }
        }),
      );
    }),
  );
  return { storages: [...storages], volids };
}

export async function listStorageContent(
  client: ProxmoxClient,
  node: string,
  storage: string,
): Promise<StorageContentItem[]> {
  const rows = await client.storage.content(node, storage);
  const items = rows
    .map((row) => normalizeStorageContentRow(row as Record<string, unknown>))
    .filter((item): item is StorageContentItem => Boolean(item));

  const guests = await client.listGuests().catch(() => ({ vms: [], containers: [] }));
  const byVmid = new Map<number, { kind: "vm" | "lxc"; name: string; node: string }>();
  for (const guest of guests.vms) {
    if (guest.vmid) byVmid.set(guest.vmid, { kind: "vm", name: guest.name, node: guest.node });
  }
  for (const guest of guests.containers) {
    if (guest.vmid) byVmid.set(guest.vmid, { kind: "lxc", name: guest.name, node: guest.node });
  }

  const needed = [...new Set(items.map((item) => item.vmid).filter((vmid): vmid is number => Boolean(vmid)))];
  const configs = new Map<number, Record<string, unknown>>();
  await Promise.all(
    needed.map(async (vmid) => {
      const guest = byVmid.get(vmid);
      if (!guest) return;
      const config =
        guest.kind === "vm"
          ? await client.vms.config(guest.node, vmid).catch(() => null)
          : await client.lxc.config(guest.node, vmid).catch(() => null);
      if (config) configs.set(vmid, config);
    }),
  );

  return items.map((item) => {
    const guest = item.vmid ? byVmid.get(item.vmid) : undefined;
    return applyVolumeUsage(item, item.vmid ? configs.get(item.vmid) : undefined, guest);
  });
}
