import { z } from "zod";
import { apiRoute } from "@/server/http/api-route";
import { json } from "@/server/http/respond";
import { clientIp } from "@/server/auth/session";
import { writeAuditLog } from "@/server/services/audit-service";
import { AUDIT_ACTIONS } from "@/lib/audit-actions";
import { withHostClient } from "@/server/services/host-service";
import { ValidationError } from "@/lib/errors";
import { parseBackupVolid } from "@/lib/backup";
import { filenameFromUrl, isHttpUrl, isoVolid, mergeIsoCatalog } from "@/lib/iso-images";
import { collectIsoVolumes } from "@/server/services/lxc-template-catalog";
import { collectVolumeUsers } from "@/server/services/volume-usage";

export const GET = apiRoute("vm.create", async (req, session, params) => {
  const nodeParam = new URL(req.url).searchParams.get("node")?.trim() || undefined;
  const data = await withHostClient(params.id, session.user, async (client) => {
    const nodes = await client.nodes.list();
    const selected = nodeParam ?? nodes[0]?.node;
    if (!selected) {
      return { nodes: [], node: "", storages: [], installed: [] as string[], catalog: [], usedBy: {} };
    }
    const nodeNames = nodes.map((n) => n.node);
    const volumes = await collectIsoVolumes(client, nodeNames);
    const catalog = mergeIsoCatalog(volumes.volids);
    const usedBy = await collectVolumeUsers(client, volumes.volids);
    return {
      nodes: nodeNames,
      node: selected,
      storages: volumes.storages,
      installed: volumes.volids,
      catalog,
      usedBy,
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

export const POST = apiRoute("vm.create", async (req, session, params) => {
  const raw = await req.json();
  const action = raw && typeof raw === "object" && "action" in raw && raw.action === "delete" ? "delete" : "download";
  if (action === "delete") {
    const body = deleteSchema.parse(raw);
    const parsed = parseBackupVolid(body.volid);
    if (!parsed.storage || !parsed.volume) throw new ValidationError("Ungültiges ISO-Volume");
    await withHostClient(params.id, session.user, async (client, host) => {
      await client.storage.deleteContent(body.node, parsed.storage, parsed.volume);
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
