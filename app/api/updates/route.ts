import { apiRoute } from "@/server/http/api-route";
import { json } from "@/server/http/respond";
import { listHosts } from "@/server/services/host-service";
import { pruneObsoleteHostUpdateJobs } from "@/server/services/update-service";
import { aptSummaryFingerprint, aptSummaryFromHosts } from "@/lib/apt-updates";

export const GET = apiRoute("updates.view", async (_req, session) => {
  const hosts = await listHosts(session.user);
  // Drop leftover silent-upgrade Job rows so the UI never shows stale failures.
  await pruneObsoleteHostUpdateJobs();
  const summary = aptSummaryFromHosts(hosts);
  return json({
    hosts,
    jobs: [] as Array<{ id: string; status: string; host?: { name: string } | null; error?: string | null }>,
    summary: { ...summary, fingerprint: aptSummaryFingerprint(summary.hosts) },
  });
});
