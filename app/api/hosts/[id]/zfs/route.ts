import { mapPool } from "@/lib/async-pool";
import { apiRoute } from "@/server/http/api-route";
import { json } from "@/server/http/respond";
import { ValidationError } from "@/lib/errors";
import { withHostClient } from "@/server/services/host-service";
import { loadHostInventory } from "@/server/services/inventory-cache";
import { summarizeZfsPool } from "@/server/proxmox/zfs-health";

const ZFS_NODE_CONCURRENCY = 2;

export const GET = apiRoute("zfs.view", async (req, session, params) => {
  const url = new URL(req.url);
  const nodeParam = url.searchParams.get("node")?.trim() || undefined;
  const poolParam = url.searchParams.get("pool")?.trim() || undefined;
  const data = await withHostClient(params.id, session.user, async (client) => {
    if (nodeParam && poolParam) {
      const [list, detail] = await Promise.all([
        client.zfs.pools(nodeParam).catch(() => []),
        client.zfs.poolDetail(nodeParam, poolParam).catch(() => null),
      ]);
      const pool = list.find((row) => row.name === poolParam);
      if (!pool && !detail) throw new ValidationError("ZFS-Pool nicht gefunden");
      const base = pool ?? { name: poolParam, health: String((detail as { health?: string } | null)?.health ?? "UNKNOWN"), size: 0, alloc: 0, free: 0 };
      return {
        node: nodeParam,
        pool: { ...base, detail, healthSummary: summarizeZfsPool(detail, base.health) },
      };
    }

    const inv = await loadHostInventory(client, params.id);
    const names = [
      ...new Set(
        inv.nodes
          .filter((n) => n.node && n.status !== "offline")
          .map((n) => n.node as string),
      ),
    ];
    // List view: pool health from the pool list only (no per-pool detail fan-out).
    const zfs = await mapPool(names, ZFS_NODE_CONCURRENCY, async (node) => {
      const list = await client.zfs.pools(node).catch(() => []);
      return {
        node,
        pools: list.map((pool) => ({
          ...pool,
          healthSummary: summarizeZfsPool(null, pool.health),
        })),
      };
    });
    return { zfs };
  });
  return json(data);
});
