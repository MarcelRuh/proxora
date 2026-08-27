import { apiRoute } from "@/server/http/api-route";
import { json } from "@/server/http/respond";
import { listHosts } from "@/server/services/host-service";
import { listJobs } from "@/server/services/update-service";

export const GET = apiRoute("updates.view", async (_req, session) => {
  const hosts = await listHosts(session.user);
  const jobs = await listJobs("host.update");
  return json({ hosts, jobs });
});
