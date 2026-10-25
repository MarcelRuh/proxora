import { mapPool } from "@/lib/async-pool";
import { prisma } from "@/lib/db";
import type { SessionUser } from "@/server/auth/session";
import { notifyAptUpdates, persistAptSnapshot } from "@/server/services/apt-refresh";
import { withHostClient } from "@/server/services/host-service";
import { inventoryNodeNames, loadHostInventory } from "@/server/services/inventory-cache";
import type { ProxmoxClient } from "@/server/proxmox/client";

const UPDATE_NODE_CONCURRENCY = 2;
const LIST_CACHE_MS = 2 * 60_000;

export type NodeUpdates = {
  node: string;
  packages: Array<{ Package: string; Version?: string; OldVersion?: string; Title?: string }>;
  count: number;
};

type ListedUpdates = { version: string | null; updates: NodeUpdates[] };

const listCache = new Map<string, { at: number; data: ListedUpdates }>();

function listCacheKey(hostId: string, node?: string) {
  return `${hostId}\n${node ?? ""}`;
}

export function clearHostUpdatesListCache(hostId?: string) {
  if (!hostId) {
    listCache.clear();
    return;
  }
  for (const key of listCache.keys()) {
    if (key.startsWith(`${hostId}\n`)) listCache.delete(key);
  }
}

async function nodesFor(client: ProxmoxClient, hostId: string, node?: string) {
  const names = inventoryNodeNames(await loadHostInventory(client, hostId));
  const nodes = names.map((n) => ({ node: n }));
  return node ? nodes.filter((n) => n.node === node) : nodes;
}

async function storeSnapshot(
  host: { id: string; name: string; aptNotifiedCount: number },
  updates: NodeUpdates[],
) {
  const count = updates.reduce((sum, n) => sum + n.count, 0);
  const snap = await persistAptSnapshot(host, count);
  if (snap.notify) {
    await notifyAptUpdates([
      { name: host.name, count, hostId: host.id, node: updates.map((u) => u.node).join(", ") || undefined },
    ]);
  }
  return count;
}

/** Counts from the last APT refresh — no Proxmox package-list calls. */
export async function summarizeHostUpdates(hostId: string, user: SessionUser) {
  return withHostClient(hostId, user, async (_client, host) => ({
    version: host.proxmoxVersion,
    count: host.aptUpdateCount,
    checkedAt: host.aptCheckedAt?.toISOString() ?? null,
  }));
}

export async function listHostUpdates(hostId: string, user: SessionUser, node?: string) {
  const key = listCacheKey(hostId, node);
  const hit = listCache.get(key);
  if (hit && Date.now() - hit.at < LIST_CACHE_MS) return hit.data;

  const data = await withHostClient(hostId, user, async (client, host) => {
    const nodes = await nodesFor(client, hostId, node);
    const updates: NodeUpdates[] = await mapPool(nodes, UPDATE_NODE_CONCURRENCY, async (n) => {
      const raw = await client.updates.list(n.node);
      const packages = Array.isArray(raw) ? raw : [];
      return { node: n.node, packages, count: packages.length };
    });
    return { version: host.proxmoxVersion, updates };
  });
  listCache.set(key, { at: Date.now(), data });
  return data;
}

export async function refreshHostUpdates(hostId: string, user: SessionUser, node?: string) {
  return withHostClient(hostId, user, async (client, host) => {
    const nodes = await nodesFor(client, hostId, node);
    if (nodes.length === 0) throw new Error("Kein Node gefunden");
    const updates: NodeUpdates[] = [];
    for (const n of nodes) {
      let lastError: unknown;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const upid = await client.updates.refresh(n.node);
          if (upid) await client.tasks.wait(n.node, upid);
          lastError = null;
          break;
        } catch (error) {
          lastError = error;
          if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 4_000));
        }
      }
      if (lastError) throw lastError;
      const packages = await client.updates.list(n.node);
      updates.push({ node: n.node, packages, count: packages.length });
    }
    await storeSnapshot(host, updates);
    const data = { version: host.proxmoxVersion, updates };
    clearHostUpdatesListCache(hostId);
    listCache.set(listCacheKey(hostId, node), { at: Date.now(), data });
    return data;
  });
}

export async function upgradeConsoleTarget(hostId: string, user: SessionUser, node?: string) {
  return withHostClient(hostId, user, async (client) => {
    const nodes = await nodesFor(client, hostId, node);
    const target = nodes[0]?.node;
    if (!target) throw new Error("Kein Node gefunden");
    return { mode: "console" as const, node: target };
  });
}

/**
 * Silent APT upgrade jobs were removed (Proxmox has no /apt/upgrade API).
 * Leftover FAILED rows kept showing as “previous update jobs” forever — drop them.
 */
export async function pruneObsoleteHostUpdateJobs(): Promise<number> {
  const result = await prisma.job.deleteMany({ where: { type: "host.update" } });
  return result.count;
}

export async function listJobs(type?: string) {
  if (type === "host.update") {
    await pruneObsoleteHostUpdateJobs();
    return [];
  }
  return prisma.job.findMany({
    where: type ? { type } : undefined,
    include: { host: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
}
