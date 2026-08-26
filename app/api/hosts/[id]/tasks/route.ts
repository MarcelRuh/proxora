import { apiRoute } from "@/server/http/api-route";
import { json } from "@/server/http/respond";
import { withHostClient } from "@/server/services/host-service";

export const GET = apiRoute("tasks.view", async (req, session, params) => {
  const url = new URL(req.url);
  const node = url.searchParams.get("node");
  const data = await withHostClient(params.id, session.user, async (client) => {
    const nodes = node ? [{ node }] : await client.nodes.list();
    const tasks = (
      await Promise.all(nodes.map((n) => client.tasks.list(n.node, { source: "all", limit: 80 })))
    ).flat();
    return { tasks };
  });
  return json(data);
});
