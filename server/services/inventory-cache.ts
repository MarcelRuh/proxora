import type { ClusterInventory, ProxmoxClient } from "@/server/proxmox/client";

export const INVENTORY_TTL_MS = 10_000;

type CachedInventory = ClusterInventory & { at: number };

const cache = new Map<string, CachedInventory>();
const inflight = new Map<string, Promise<ClusterInventory>>();

function cacheKey(hostId: string, client: ProxmoxClient) {
  return `${hostId}:${client.http.baseUrl}`;
}

function withoutTimestamp(entry: CachedInventory): ClusterInventory {
  return {
    nodes: entry.nodes,
    vms: entry.vms,
    containers: entry.containers,
    storage: entry.storage,
  };
}

export function clearInventoryCache() {
  cache.clear();
  inflight.clear();
}

export function invalidateInventoryCache(hostId?: string) {
  if (!hostId) {
    clearInventoryCache();
    return;
  }
  const prefix = `${hostId}:`;
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
  for (const key of inflight.keys()) {
    if (key.startsWith(prefix)) inflight.delete(key);
  }
}

/** One cluster/resources fetch per host, shared by dashboard, guests, and search for 10s. */
export async function loadHostInventory(
  client: ProxmoxClient,
  hostId: string,
  options?: { maxAgeMs?: number },
): Promise<ClusterInventory> {
  const key = cacheKey(hostId, client);
  const maxAge = options?.maxAgeMs ?? INVENTORY_TTL_MS;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < maxAge) return withoutTimestamp(hit);

  const pending = inflight.get(key);
  if (pending) return pending;

  const task = (async () => {
    const inv = await client.listInventory();
    cache.set(key, { ...inv, at: Date.now() });
    return inv;
  })();
  inflight.set(key, task);
  try {
    return await task;
  } finally {
    inflight.delete(key);
  }
}
