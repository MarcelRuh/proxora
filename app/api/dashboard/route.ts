import { apiRoute } from "@/server/http/api-route";
import { json } from "@/server/http/respond";
import { getDashboard } from "@/server/services/dashboard-service";

export const GET = apiRoute("hosts.view", async (_req, session) => {
  return json(await getDashboard(session.user));
});
