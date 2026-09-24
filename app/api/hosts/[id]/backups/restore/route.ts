import { apiRoute } from "@/server/http/api-route";
import { json } from "@/server/http/respond";
import { getRestoreJob } from "@/server/services/restore-jobs";

export const GET = apiRoute(["backup.restore", "backup.view"], async (req, _session, params) => {
  const id = new URL(req.url).searchParams.get("job") ?? "";
  const job = getRestoreJob(params.id, id);
  if (!job) return json({ error: "Restore-Job nicht gefunden", code: "NOT_FOUND" }, 404);
  return json(job);
});
