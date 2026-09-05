import { z } from "zod";
import { apiRoute } from "@/server/http/api-route";
import { json } from "@/server/http/respond";
import { clientIp } from "@/server/auth/session";
import { writeAuditLog } from "@/server/services/audit-service";
import { AUDIT_ACTIONS } from "@/lib/audit-actions";
import { withHostClient } from "@/server/services/host-service";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import { parseBackupVolid } from "@/lib/backup";
import { isVztmplContentVolid, mergeTemplateCatalog, normalizeAplTemplate, vztmplVolid } from "@/lib/lxc-templates";
import { collectVztmplVolumes } from "@/server/services/lxc-template-catalog";
import { inventoryNodeNames, loadHostInventory } from "@/server/services/inventory-cache";
import { clearVolumeListCache } from "@/server/services/storage-content";
import { collectVolumeUsers } from "@/server/services/volume-usage";
import { userHasPermission } from "@/lib/permissions";

export const GET = apiRoute("lxc.create", async (req, session, params) => {
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
    const volumes = await collectVztmplVolumes(client, nodeNames);
    if (usageOnly) {
      return {
        nodes: nodeNames,
        node: selected,
        storages: volumes.storages,
        installed: volumes.volids,
        catalog: [],
        usedBy: await collectVolumeUsers(client, params.id, volumes.volids, { kind: "lxc" }),
      };
    }
    const catalogRaw = await client.nodes.aplinfo(selected).catch(() => [] as Array<Record<string, unknown>>);
    const catalog = mergeTemplateCatalog(
      catalogRaw.map((row) => normalizeAplTemplate(row)).filter((row): row is NonNullable<typeof row> => Boolean(row)),
      volumes.volids,
    );
    return {
      nodes: nodeNames,
      node: selected,
      storages: volumes.storages,
      installed: volumes.volids,
      catalog,
      usedBy: {},
    };
  });
  return json(data);
});

const downloadSchema = z.object({
  action: z.literal("download").optional(),
  node: z.string().min(1, "Node fehlt"),
  storage: z.string().min(1, "Storage fehlt"),
  template: z.string().min(1, "Template fehlt"),
});

const deleteSchema = z.object({
  action: z.literal("delete"),
  node: z.string().min(1, "Node fehlt"),
  volid: z.string().min(1, "Volume fehlt"),
});

export const POST = apiRoute(["lxc.create", "storage.delete"], async (req, session, params) => {
  const raw = await req.json();
  const action = raw && typeof raw === "object" && "action" in raw && raw.action === "delete" ? "delete" : "download";
  if (action === "delete") {
    if (!userHasPermission(session.user, "storage.delete", params.id)) throw new ForbiddenError();
    const body = deleteSchema.parse(raw);
    const parsed = parseBackupVolid(body.volid);
    if (!parsed.storage || !parsed.volume || !isVztmplContentVolid(body.volid)) {
      throw new ValidationError("Ungültiges Template-Volume");
    }
    await withHostClient(params.id, session.user, async (client, host) => {
      await client.storage.deleteContent(body.node, parsed.storage, parsed.volume);
      clearVolumeListCache(client);
      await writeAuditLog({
        userId: session.user.id,
        ip: await clientIp(),
        action: AUDIT_ACTIONS.LXC_TEMPLATE_DELETED,
        target: parsed.filename || body.volid,
        hostId: params.id,
        result: "SUCCESS",
        metadata: { node: body.node, volid: body.volid, host: host.name },
      });
    });
    return json({ ok: true, volid: body.volid });
  }

  if (!userHasPermission(session.user, "lxc.create", params.id)) throw new ForbiddenError();
  const body = downloadSchema.parse(raw);
  const result = await withHostClient(params.id, session.user, async (client, host) => {
    const upid = await client.nodes.downloadAppliance(body.node, body.storage, body.template);
    if (!upid) throw new ValidationError("Proxmox hat keinen Download-Task zurückgegeben");
    clearVolumeListCache(client);
    await writeAuditLog({
      userId: session.user.id,
      ip: await clientIp(),
      action: AUDIT_ACTIONS.LXC_TEMPLATE_DOWNLOADED,
      target: body.template,
      hostId: params.id,
      result: "SUCCESS",
      metadata: { node: body.node, storage: body.storage, upid, host: host.name },
    });
    return { upid, node: body.node, volid: vztmplVolid(body.storage, body.template) };
  });
  return json(result, 201);
});
