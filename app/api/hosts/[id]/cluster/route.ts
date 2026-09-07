import { apiRoute } from "@/server/http/api-route";
import { json } from "@/server/http/respond";
import { withHostClient } from "@/server/services/host-service";
import { loadClusterOverview } from "@/server/services/cluster-service";

export const GET = apiRoute("hosts.view", async (_req, session, params) => {
  const data = await withHostClient(params.id, session.user, async (client, host) => {
    return loadClusterOverview(client, host);
  });
  return json(data);
});
