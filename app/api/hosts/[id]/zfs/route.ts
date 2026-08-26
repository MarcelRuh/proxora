import { apiRoute } from "@/server/http/api-route";
import { json } from "@/server/http/respond";
import { withHostClient } from "@/server/services/host-service";
import { summarizeZfsPool } from "@/server/proxmox/zfs-health";

export const GET = apiRoute("zfs.view", async (_req, session, params) => {
  const data = await withHostClient(params.id, session.user, async (client) => {
    const nodes = await client.nodes.list();
    const pools = await Promise.all(
      nodes.map(async (n) => {
        const list = await client.zfs.pools(n.node).catch(() => []);
        const details = await Promise.all(
          list.map(async (pool) => {
            const detail = await client.zfs.poolDetail(n.node, pool.name).catch(() => null);
            return { ...pool, detail, healthSummary: summarizeZfsPool(detail, pool.health) };
          }),
        );
        return { node: n.node, pools: details };
      }),
    );
    return { zfs: pools };
  });
  return json(data);
});
