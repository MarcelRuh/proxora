import { guestIpFromVmid, type GuestIpNetwork } from "@/lib/create-ip";
import { nextSmallerVmid } from "@/lib/next-vmid";
import { inventoryStorageForNode, type StorageOverviewItem } from "@/lib/storage-overview";
import type { ProxmoxClient } from "@/server/proxmox/client";
import type { ProxmoxStorage } from "@/server/proxmox/types";
import { collectUsedGuestIpsForHost, collectUsedVmidsForHost } from "@/server/services/guest-ips";
import { inventoryNodeNames, loadHostInventory } from "@/server/services/inventory-cache";
import { collectIsoVolumes, collectVztmplVolumes } from "@/server/services/lxc-template-catalog";
import type { Host } from "@prisma/client";

const emptyMedia = { isos: [] as Array<{ volid: string }>, templates: [] as Array<{ volid: string }> };

function asOverviewStorage(list: ProxmoxStorage[]): StorageOverviewItem[] {
  return list.map((row) => ({
    storage: row.storage,
    type: row.type,
    content: row.content,
    active: row.active,
    enabled: row.enabled,
    used: row.used,
    avail: row.avail,
    total: row.total,
  }));
}

export async function loadCreateShell(
  client: ProxmoxClient,
  hostId: string,
  nodeParam?: string,
): Promise<{
  nodes: Array<{ node: string }>;
  selected: string;
  storage: StorageOverviewItem[];
  bridges: Array<{ iface?: string; type?: string }>;
}> {
  const inv = await loadHostInventory(client, hostId);
  const nodeNames = inventoryNodeNames(inv);
  const selected = nodeParam || nodeNames[0] || "";
  if (!selected) {
    return { nodes: [], selected: "", storage: [], bridges: [] };
  }
  const fromInv = inventoryStorageForNode(inv.storage, selected);
  const [storage, network] = await Promise.all([
    fromInv.some((row) => row.content)
      ? Promise.resolve(fromInv)
      : client.storage.list(selected).then(asOverviewStorage),
    client.nodes.network(selected).catch(() => []),
  ]);
  const bridges = network.filter((n) => n.type === "bridge" || String(n.iface ?? "").startsWith("vmbr"));
  return {
    nodes: nodeNames.map((node) => ({ node })),
    selected,
    storage,
    bridges,
  };
}

export async function loadCreateMedia(client: ProxmoxClient, hostId: string, nodeParam?: string) {
  const inv = await loadHostInventory(client, hostId);
  const nodeNames = inventoryNodeNames(inv);
  const selected = nodeParam || nodeNames[0] || "";
  if (!selected) return emptyMedia;
  const [{ volids: templateVolids }, { volids: isoVolids }] = await Promise.all([
    collectVztmplVolumes(client, nodeNames),
    collectIsoVolumes(client, nodeNames),
  ]);
  return {
    templates: templateVolids.map((volid) => ({ volid })),
    isos: isoVolids.map((volid) => ({ volid })),
  };
}

export async function loadCreateIdentity(
  host: Host,
  networks: GuestIpNetwork[],
  withIps: boolean,
): Promise<{ nextid: number; usedIps: string[]; usedVmids: number[] }> {
  if (withIps) {
    const used = await collectUsedGuestIpsForHost(host);
    const defaultNet = networks[0]?.id ?? "192.168.178.0";
    const usedIpSet = new Set(used.ips);
    const nextid =
      used.vmids.length > 0
        ? nextSmallerVmid(used.vmids, undefined, (id) => {
            const ip = guestIpFromVmid(defaultNet, id, networks);
            return Boolean(ip && usedIpSet.has(ip));
          })
        : nextSmallerVmid([]);
    return { nextid, usedIps: used.ips, usedVmids: used.vmids };
  }
  const usedVmids = await collectUsedVmidsForHost(host);
  return {
    nextid: nextSmallerVmid(usedVmids),
    usedIps: [],
    usedVmids,
  };
}
