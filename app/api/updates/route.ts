import { z } from "zod";
import { apiRoute } from "@/server/http/api-route";
import { json } from "@/server/http/respond";
import { clientIp } from "@/server/auth/session";
import { writeAuditLog } from "@/server/services/audit-service";
import { AUDIT_ACTIONS } from "@/lib/audit-actions";
import { listHosts } from "@/server/services/host-service";
import { listJobs, queueAllHostUpdates } from "@/server/services/update-service";

export const GET = apiRoute("updates.view", async (_req, session) => {
  const hosts = await listHosts(session.user);
  const jobs = await listJobs("host.update");
  return json({ hosts, jobs });
});

export const POST = apiRoute("updates.execute", async (req, session) => {
  const body = z.object({ confirm: z.literal(true) }).parse(await req.json());
  void body;
  const jobs = await queueAllHostUpdates(session.user);
  await writeAuditLog({
    userId: session.user.id,
    ip: await clientIp(),
    action: AUDIT_ACTIONS.UPDATE_STARTED,
    target: "all-hosts",
    result: "SUCCESS",
    metadata: { count: jobs.length },
  });
  return json({ jobs });
});
