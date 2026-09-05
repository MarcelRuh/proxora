import { apiRoute } from "@/server/http/api-route";
import { json } from "@/server/http/respond";
import { withHostClient } from "@/server/services/host-service";
import { inventoryNodeNames, loadHostInventory } from "@/server/services/inventory-cache";
import { summarizeZfsPool } from "@/server/proxmox/zfs-health";

export const GET = apiRoute("zfs.view", async (_req, session, params) => {
  const data = await withHostClient(params.id, session.user, async (client) => {
    const names = inventoryNodeNames(await loadHostInventory(client, params.id));
    const pools = await Promise.all(
      names.map(async (node) => {
        const list = await client.zfs.pools(node).catch(() => []);
        const details = await Promise.all(
          list.map(async (pool) => {
            const detail = await client.zfs.poolDetail(node, pool.name).catch(() => null);
            return { ...pool, detail, healthSummary: summarizeZfsPool(detail, pool.health) };
          }),
        );
        return { node, pools: details };
      }),
    );
    return { zfs: pools };
  });
  return json(data);
});
