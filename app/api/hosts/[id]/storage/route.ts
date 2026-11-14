import { apiRoute } from "@/server/http/api-route";
import { json } from "@/server/http/respond";
import { clientIp } from "@/server/auth/session";
import { writeAuditLog } from "@/server/services/audit-service";
import { AUDIT_ACTIONS } from "@/lib/audit-actions";
import { inventoryToStorageOverview } from "@/lib/storage-overview";
import { storageCreateAuditMeta, storageCreateBody, storageCreateSchema } from "@/lib/storage-create";
import { assertHostWideBackupAction } from "@/lib/backup-scope";
import { withHostClient } from "@/server/services/host-service";
import { invalidateInventoryCache, loadHostInventory } from "@/server/services/inventory-cache";

export const GET = apiRoute("storage.view", async (_req, session, params) => {
  const data = await withHostClient(params.id, session.user, async (client) => {
    const inv = await loadHostInventory(client, params.id);
    return { storage: inventoryToStorageOverview(inv.storage) };
  });
  return json(data);
});

/** Adds a datacenter storage (Proxmox POST /storage). */
export const POST = apiRoute("storage.config", async (req, session, params) => {
  // Storage config is cluster-wide: never for users limited to single guests.
  assertHostWideBackupAction(session.user);
  const input = storageCreateSchema.parse(await req.json());
  const body = storageCreateBody(input);
  const meta = storageCreateAuditMeta(input);
  const ip = await clientIp();
  try {
    await withHostClient(params.id, session.user, async (client, host) => {
      await client.storage.create(body);
      meta.host = host.name;
    });
  } catch (error) {
    await writeAuditLog({
      userId: session.user.id,
      ip,
      action: AUDIT_ACTIONS.STORAGE_CREATED,
      target: input.storage,
      hostId: params.id,
      result: "FAILURE",
      metadata: { ...meta, error: error instanceof Error ? error.message : String(error) },
    });
    throw error;
  }
  invalidateInventoryCache(params.id);
  await writeAuditLog({
    userId: session.user.id,
    ip,
    action: AUDIT_ACTIONS.STORAGE_CREATED,
    target: input.storage,
    hostId: params.id,
    result: "SUCCESS",
    metadata: meta,
  });
  return json({ ok: true, storage: input.storage }, 201);
});
