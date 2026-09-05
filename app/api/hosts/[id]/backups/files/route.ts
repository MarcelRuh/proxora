import { apiRoute } from "@/server/http/api-route";
import { json } from "@/server/http/respond";
import { listHostBackupFiles } from "@/server/services/backup-service";

export const maxDuration = 120;

export const GET = apiRoute("backup.view", async (_req, session, params) => {
  return json(await listHostBackupFiles(params.id, session.user));
});
