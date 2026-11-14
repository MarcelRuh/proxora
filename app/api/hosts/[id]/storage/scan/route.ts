import { apiRoute } from "@/server/http/api-route";
import { json } from "@/server/http/respond";
import { assertHostWideBackupAction } from "@/lib/backup-scope";
import { storageScanOptions, storageScanSchema } from "@/lib/storage-create";
import { withHostClient } from "@/server/services/host-service";

/**
 * Discovers NFS exports, SMB shares, PBS datastores, LVM VGs / thin pools and ZFS pools.
 * POST so CIFS / PBS credentials never end up in URLs or access logs.
 */
export const POST = apiRoute("storage.config", async (req, session, params) => {
  assertHostWideBackupAction(session.user);
  const input = storageScanSchema.parse(await req.json());
  const query: Record<string, string | number> = {};
  switch (input.kind) {
    case "nfs":
      query.server = input.server;
      break;
    case "cifs":
      query.server = input.server;
      if (input.username) {
        query.username = input.username;
        if (input.password) query.password = input.password;
      }
      if (input.domain) query.domain = input.domain;
      break;
    case "pbs":
      query.server = input.server;
      query.username = input.username;
      query.password = input.password;
      if (input.port) query.port = input.port;
      if (input.fingerprint) query.fingerprint = input.fingerprint.toLowerCase();
      break;
    case "lvmthin":
      query.vg = input.vg;
      break;
  }
  const rows = await withHostClient(params.id, session.user, (client) =>
    client.storage.scan(input.node, input.kind, query),
  );
  return json({ options: storageScanOptions(input.kind, rows) });
});
