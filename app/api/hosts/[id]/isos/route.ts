import { z } from "zod";
import { apiRoute } from "@/server/http/api-route";
import { json } from "@/server/http/respond";
import { clientIp } from "@/server/auth/session";
import { writeAuditLog } from "@/server/services/audit-service";
import { AUDIT_ACTIONS } from "@/lib/audit-actions";
import { withHostClient } from "@/server/services/host-service";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import { parseBackupVolid } from "@/lib/backup";
import { filenameFromUrl, isHttpUrl, isoVolid, isIsoContentVolid, mergeIsoCatalog } from "@/lib/iso-images";
import { collectIsoVolumes } from "@/server/services/lxc-template-catalog";
import { inventoryNodeNames, loadHostInventory } from "@/server/services/inventory-cache";
import { clearVolumeListCache } from "@/server/services/storage-content";
import { collectVolumeUsers } from "@/server/services/volume-usage";
import { userHasPermission } from "@/lib/permissions";

export const GET = apiRoute("vm.create", async (req, session, params) => {
  const url = new URL(req.url);
  const nodeParam = url.searchParams.get("node")?.trim() || undefined;
  const usageOnly = url.searchParams.get("usage") === "1";
  const data = await withHostClient(params.id, session.user, async (client) => {
    const inv = await loadHostInventory(client, params.id);
    const nodeNames = inventoryNodeNames(inv);
    const selected = nodeParam ?? nodeNames[0] ?? "";
    if (!selected) {
      return { nodes: [], node: "", storages: [], installed: [] as string[], catalog: [], usedBy: {} };
    }
    const volumes = await collectIsoVolumes(client, nodeNames);
    if (usageOnly) {
      return {
        nodes: nodeNames,
        node: selected,
        storages: volumes.storages,
        installed: volumes.volids,
        catalog: [],
        usedBy: await collectVolumeUsers(client, params.id, volumes.volids, { kind: "vm" }),
      };
    }
    return {
      nodes: nodeNames,
      node: selected,
      storages: volumes.storages,
      installed: volumes.volids,
      catalog: mergeIsoCatalog(volumes.volids),
      usedBy: {},
    };
  });
  return json(data);
});

const downloadSchema = z.object({
  action: z.literal("download").optional(),
  node: z.string().min(1, "Node fehlt"),
  storage: z.string().min(1, "Storage fehlt"),
  url: z.string().min(1, "URL fehlt"),
  filename: z.string().optional(),
});

const deleteSchema = z.object({
  action: z.literal("delete"),
  node: z.string().min(1, "Node fehlt"),
  volid: z.string().min(1, "Volume fehlt"),
});

export const POST = apiRoute(["vm.create", "storage.delete"], async (req, session, params) => {
  const raw = await req.json();
  const action = raw && typeof raw === "object" && "action" in raw && raw.action === "delete" ? "delete" : "download";
  if (action === "delete") {
    if (!userHasPermission(session.user, "storage.delete", params.id)) throw new ForbiddenError();
    const body = deleteSchema.parse(raw);
    const parsed = parseBackupVolid(body.volid);
    if (!parsed.storage || !parsed.volume || !isIsoContentVolid(body.volid)) {
      throw new ValidationError("Ungültiges ISO-Volume");
    }
    await withHostClient(params.id, session.user, async (client, host) => {
      await client.storage.deleteContent(body.node, parsed.storage, parsed.volume);
      clearVolumeListCache(client);
      await writeAuditLog({
        userId: session.user.id,
        ip: await clientIp(),
        action: AUDIT_ACTIONS.ISO_DELETED,
        target: parsed.filename || body.volid,
        hostId: params.id,
        result: "SUCCESS",
        metadata: { node: body.node, volid: body.volid, host: host.name },
      });
    });
    return json({ ok: true, volid: body.volid });
  }

  if (!userHasPermission(session.user, "vm.create", params.id)) throw new ForbiddenError();
  const body = downloadSchema.parse(raw);
  if (!isHttpUrl(body.url)) throw new ValidationError("Nur http(s)-URLs sind erlaubt");
  const filename = (body.filename?.trim() || filenameFromUrl(body.url)).trim();
  if (!filename || !/\.iso$/i.test(filename)) throw new ValidationError("ISO-Dateiname fehlt (.iso)");

  const result = await withHostClient(params.id, session.user, async (client, host) => {
    const upid = await client.storage.downloadUrl(body.node, body.storage, {
      content: "iso",
      url: body.url,
      filename,
    });
    if (!upid) throw new ValidationError("Proxmox hat keinen Download-Task zurückgegeben");
    clearVolumeListCache(client);
    await writeAuditLog({
      userId: session.user.id,
      ip: await clientIp(),
      action: AUDIT_ACTIONS.ISO_DOWNLOADED,
      target: filename,
      hostId: params.id,
      result: "SUCCESS",
      metadata: { node: body.node, storage: body.storage, url: body.url, upid, host: host.name },
    });
    return { upid, node: body.node, volid: isoVolid(body.storage, filename), filename };
  });
  return json(result, 201);
});
