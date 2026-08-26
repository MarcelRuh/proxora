import { apiRoute } from "@/server/http/api-route";
import { json } from "@/server/http/respond";
import { withHostClient } from "@/server/services/host-service";

export const GET = apiRoute("storage.view", async (_req, session, params) => {
  const data = await withHostClient(params.id, session.user, async (client) => {
    const nodes = await client.nodes.list();
    const storage = await Promise.all(
      nodes.map(async (n) => {
        const list = await client.storage.list(n.node);
        return { node: n.node, storage: list };
      }),
    );
    return { storage };
  });
  return json(data);
});
