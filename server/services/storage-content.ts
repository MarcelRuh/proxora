import type { ProxmoxClient } from "@/server/proxmox/client";
import type { ProxmoxStorage } from "@/server/proxmox/types";
import { mapPool } from "@/lib/async-pool";
import { isIsoRow } from "@/lib/iso-images";
import { isVztmplRow, storageContentVolid } from "@/lib/lxc-templates";
import { applyVolumeUsage, normalizeStorageContentRow, type StorageContentItem } from "@/lib/storage-content";
import { loadHostInventory } from "@/server/services/inventory-cache";

export const STORAGE_CONTENT_CONCURRENCY = 4;
export const VOLUME_LIST_TTL_MS = 20_000;

type StoreTarget = { node: string; storage: string };
type CachedVolumes = { at: number; storages: string[]; volids: string[] };

const volumeListCache = new Map<string, CachedVolumes>();

export function clearVolumeListCache(client?: ProxmoxClient) {
  if (!client) {
    volumeListCache.clear();
    return;
  }
  const prefix = `${client.http.baseUrl}:`;
  for (const key of [...volumeListCache.keys()]) {
    if (key.startsWith(prefix)) volumeListCache.delete(key);
  }
}

function isSharedStore(store: { shared?: number | boolean }): boolean {
  return store.shared === 1 || store.shared === true;
}

function storeNodes(store: { nodes?: string }, fallback: string[]): string[] {
  const listed = (store.nodes ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  return listed.length ? fallback.filter((node) => listed.includes(node)) : fallback;
}

export async function resolveStoreTargets(
  client: ProxmoxClient,
  nodes: string[],
  content: string,
): Promise<StoreTarget[]> {
  const cluster = await client.storage.list().catch(() => [] as ProxmoxStorage[]);
  const eligible = cluster.filter((store) => (store.content ?? "").includes(content));
  const targets: StoreTarget[] = [];
  const seen = new Set<string>();

  const push = (node: string | undefined, storage: string) => {
    if (!node || !storage) return;
    const key = `${node}:${storage}`;
    if (seen.has(key)) return;
    seen.add(key);
    targets.push({ node, storage });
  };

  if (eligible.length) {
    const primary = nodes[0];
    for (const store of eligible) {
      if (isSharedStore(store)) {
        push(storeNodes(store, nodes)[0] ?? primary, store.storage);
      } else {
        for (const node of storeNodes(store, nodes)) push(node, store.storage);
      }
    }
    return targets;
  }

  await mapPool(nodes, STORAGE_CONTENT_CONCURRENCY, async (node) => {
    const list = await client.storage.list(node).catch(() => [] as ProxmoxStorage[]);
    for (const store of list.filter((row) => (row.content ?? "").includes(content))) {
      push(node, store.storage);
    }
  });
  return targets;
}

export async function listStorageContentRows(
  client: ProxmoxClient,
  nodes: string[],
  content: string,
): Promise<Array<{ node: string; storage: string; row: Record<string, unknown> }>> {
  const targets = await resolveStoreTargets(client, nodes, content);
  const batches = await mapPool(targets, STORAGE_CONTENT_CONCURRENCY, async (target) => {
    const rows = await client.storage.content(target.node, target.storage, content).catch(() => []);
    return rows.map((row) => ({
      node: target.node,
      storage: target.storage,
      row: row as Record<string, unknown>,
    }));
  });
  return batches.flat();
}

export async function collectStorageVolumes(
  client: ProxmoxClient,
  nodes: string[],
  content: "vztmpl" | "iso",
): Promise<{ storages: string[]; volids: string[] }> {
  const cacheKey = `${client.http.baseUrl}:${content}`;
  const hit = volumeListCache.get(cacheKey);
  if (hit && Date.now() - hit.at < VOLUME_LIST_TTL_MS) {
    return { storages: hit.storages, volids: hit.volids };
  }

  const match = content === "iso" ? isIsoRow : isVztmplRow;
  const targets = await resolveStoreTargets(client, nodes, content);
  const storages = [...new Set(targets.map((target) => target.storage))];
  const batches = await mapPool(targets, STORAGE_CONTENT_CONCURRENCY, async (target) => {
    let rows = await client.storage.content(target.node, target.storage, content).catch(() => []);
    if (!rows.length) {
      rows = (await client.storage.content(target.node, target.storage).catch(() => [])).filter((row) =>
        match(row as Record<string, unknown>),
      );
    }
    const volids: string[] = [];
    for (const row of rows) {
      const volid = storageContentVolid(row as Record<string, unknown>);
      if (volid) volids.push(volid);
    }
    return volids;
  });

  const seen = new Set<string>();
  const volids: string[] = [];
  for (const volid of batches.flat()) {
    if (seen.has(volid)) continue;
    seen.add(volid);
    volids.push(volid);
  }

  const result = { storages, volids };
  volumeListCache.set(cacheKey, { at: Date.now(), ...result });
  return result;
}

export async function listStorageContent(
  client: ProxmoxClient,
  hostId: string,
  node: string,
  storage: string,
): Promise<StorageContentItem[]> {
  const rows = await client.storage.content(node, storage);
  const items = rows
    .map((row) => normalizeStorageContentRow(row as Record<string, unknown>))
    .filter((item): item is StorageContentItem => Boolean(item));

  const guests = await loadHostInventory(client, hostId).catch(() => ({ vms: [], containers: [] }));
  const byVmid = new Map<number, { kind: "vm" | "lxc"; name: string; node: string }>();
  for (const guest of guests.vms) {
    if (guest.vmid) byVmid.set(guest.vmid, { kind: "vm", name: guest.name, node: guest.node });
  }
  for (const guest of guests.containers) {
    if (guest.vmid) byVmid.set(guest.vmid, { kind: "lxc", name: guest.name, node: guest.node });
  }

  const needed = [...new Set(items.map((item) => item.vmid).filter((vmid): vmid is number => Boolean(vmid)))];
  const configs = new Map<number, Record<string, unknown>>();
  await mapPool(needed, STORAGE_CONTENT_CONCURRENCY, async (vmid) => {
    const guest = byVmid.get(vmid);
    if (!guest) return;
    const config =
      guest.kind === "vm"
        ? await client.vms.config(guest.node, vmid).catch(() => null)
        : await client.lxc.config(guest.node, vmid).catch(() => null);
    if (config) configs.set(vmid, config);
  });

  return items.map((item) => {
    const guest = item.vmid ? byVmid.get(item.vmid) : undefined;
    return applyVolumeUsage(item, item.vmid ? configs.get(item.vmid) : undefined, guest);
  });
}
