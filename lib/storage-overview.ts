export type InventoryStorageRow = {
  storage: string;
  type: string;
  node?: string;
  content?: string;
  disk?: number;
  maxdisk?: number;
  status?: string;
  shared?: number;
};

export type StorageOverviewItem = {
  storage: string;
  type: string;
  content?: string;
  active?: number;
  enabled?: number;
  used?: number;
  avail?: number;
  total?: number;
};

export function mapInventoryStorageRow(item: InventoryStorageRow): StorageOverviewItem {
  const used = item.disk ?? 0;
  const total = item.maxdisk ?? 0;
  return {
    storage: item.storage,
    type: item.type,
    content: item.content,
    active: item.status === "offline" ? 0 : 1,
    enabled: 1,
    used,
    avail: Math.max(0, total - used),
    total,
  };
}

/** Disk stores visible when creating a guest on `node` (shared + that node's local). */
export function inventoryStorageForNode(storage: InventoryStorageRow[], node: string): StorageOverviewItem[] {
  const rows = storage.filter(
    (item) => Boolean(item.storage) && (item.shared === 1 || !item.node || item.node === node),
  );
  const seen = new Set<string>();
  const out: StorageOverviewItem[] = [];
  for (const item of rows) {
    if (seen.has(item.storage)) continue;
    seen.add(item.storage);
    out.push(mapInventoryStorageRow(item));
  }
  return out;
}

export function inventoryToStorageOverview(
  storage: InventoryStorageRow[],
): Array<{ node: string; storage: StorageOverviewItem[] }> {
  const byNode = new Map<string, StorageOverviewItem[]>();
  const seen = new Set<string>();
  for (const item of storage) {
    if (!item.storage) continue;
    const node = item.node ?? "";
    const key = `${node}:${item.storage}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const list = byNode.get(node) ?? [];
    list.push(mapInventoryStorageRow(item));
    byNode.set(node, list);
  }
  return [...byNode.entries()].map(([node, rows]) => ({ node, storage: rows }));
}
