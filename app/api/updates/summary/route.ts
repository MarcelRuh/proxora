import { aptSummaryFingerprint, aptSummaryFromHosts } from "@/lib/apt-updates";
import { apiRoute } from "@/server/http/api-route";
import { json } from "@/server/http/respond";
import { listHosts } from "@/server/services/host-service";

export const GET = apiRoute("updates.view", async (_req, session) => {
  const hosts = await listHosts(session.user);
  const summary = aptSummaryFromHosts(hosts);
  return json({
    ...summary,
    fingerprint: aptSummaryFingerprint(summary.hosts),
  });
});
