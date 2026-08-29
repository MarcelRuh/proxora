import { z } from "zod";
import { apiRoute } from "@/server/http/api-route";
import { json } from "@/server/http/respond";
import { clientIp } from "@/server/auth/session";
import { writeAuditLog } from "@/server/services/audit-service";
import { AUDIT_ACTIONS } from "@/lib/audit-actions";
import { withHostClient } from "@/server/services/host-service";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import { parseBackupVolid } from "@/lib/backup";
import { hasPermission } from "@/lib/permissions";
import { storageContentDeletePermission, storageContentKind } from "@/lib/storage-content";
import { listStorageContent } from "@/server/services/storage-content";

export const GET = apiRoute("storage.view", async (req, session, params) => {
  const url = new URL(req.url);
  const node = url.searchParams.get("node")?.trim() ?? "";
  const storage = url.searchParams.get("storage")?.trim() ?? "";
  if (!node || !storage) throw new ValidationError("Node und Storage fehlen");
  const data = await withHostClient(params.id, session.user, async (client) => {
    const items = await listStorageContent(client, node, storage);
    return { node, storage, items };
  });
  return json(data);
});

const deleteSchema = z.object({
  action: z.literal("delete"),
  node: z.string().min(1, "Node fehlt"),
  volid: z.string().min(1, "Volume fehlt"),
});

export const POST = apiRoute(["storage.delete", "backup.delete"], async (req, session, params) => {
  const body = deleteSchema.parse(await req.json());
  const parsed = parseBackupVolid(body.volid);
  if (!parsed.storage || !parsed.volume) throw new ValidationError("Ungültiges Volume");
  const content = storageContentKind({ volid: body.volid, content: parsed.volume.includes("backup") ? "backup" : "" });
  const needed = storageContentDeletePermission(content);
  if (!hasPermission(session.user.role.permissions, needed)) throw new ForbiddenError();

  await withHostClient(params.id, session.user, async (client, host) => {
    await client.storage.deleteContent(body.node, parsed.storage, parsed.volume);
    await writeAuditLog({
      userId: session.user.id,
      ip: await clientIp(),
      action: AUDIT_ACTIONS.STORAGE_CONTENT_DELETED,
      target: parsed.filename || body.volid,
      hostId: params.id,
      result: "SUCCESS",
      metadata: { node: body.node, volid: body.volid, host: host.name, content },
    });
  });
  return json({ ok: true, volid: body.volid });
});
