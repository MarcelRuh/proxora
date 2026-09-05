import { apiRoute } from "@/server/http/api-route";
import { json } from "@/server/http/respond";
import { withHostClient } from "@/server/services/host-service";
import { inventoryNodeNames, loadHostInventory } from "@/server/services/inventory-cache";

export const GET = apiRoute("storage.view", async (_req, session, params) => {
  const data = await withHostClient(params.id, session.user, async (client) => {
    const names = inventoryNodeNames(await loadHostInventory(client, params.id));
    const storage = await Promise.all(
      names.map(async (node) => {
        const list = await client.storage.list(node);
        return { node, storage: list };
      }),
    );
    return { storage };
  });
  return json(data);
});
