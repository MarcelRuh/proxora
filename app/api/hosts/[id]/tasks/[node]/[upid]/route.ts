import { apiRoute } from "@/server/http/api-route";
import { json } from "@/server/http/respond";
import { withHostClient } from "@/server/services/host-service";
import { assertTaskAccess } from "@/lib/task-scope";

export const GET = apiRoute("tasks.view", async (_req, session, params) => {
  assertTaskAccess(session.user, params.id, params.node, params.upid);
  const data = await withHostClient(params.id, session.user, async (client) => {
    const [status, log] = await Promise.all([
      client.tasks.status(params.node, params.upid),
      client.tasks.log(params.node, params.upid),
    ]);
    return { status, log };
  });
  return json(data);
});
