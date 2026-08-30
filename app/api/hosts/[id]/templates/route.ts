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
import { collectVolumeUsers } from "@/server/services/volume-usage";
import { hasPermission } from "@/lib/permissions";

export const GET = apiRoute("lxc.create", async (req, session, params) => {
  const nodeParam = new URL(req.url).searchParams.get("node")?.trim() || undefined;
  const data = await withHostClient(params.id, session.user, async (client) => {
    const nodes = await client.nodes.list();
    const selected = nodeParam ?? nodes[0]?.node;
    if (!selected) {
      return { nodes: [], node: "", storages: [], installed: [] as string[], catalog: [], usedBy: {} };
    }
    const nodeNames = nodes.map((n) => n.node);
    const [catalogRaw, volumes] = await Promise.all([
      client.nodes.aplinfo(selected).catch(() => [] as Array<Record<string, unknown>>),
      collectVztmplVolumes(client, nodeNames),
    ]);
    const catalog = mergeTemplateCatalog(
      catalogRaw.map((row) => normalizeAplTemplate(row)).filter((row): row is NonNullable<typeof row> => Boolean(row)),
      volumes.volids,
    );
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
    if (!hasPermission(session.user.role.permissions, "storage.delete")) throw new ForbiddenError();
    const body = deleteSchema.parse(raw);
    const parsed = parseBackupVolid(body.volid);
    if (!parsed.storage || !parsed.volume || !isVztmplContentVolid(body.volid)) {
      throw new ValidationError("Ungültiges Template-Volume");
    }
    await withHostClient(params.id, session.user, async (client, host) => {
      await client.storage.deleteContent(body.node, parsed.storage, parsed.volume);
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

  if (!hasPermission(session.user.role.permissions, "lxc.create")) throw new ForbiddenError();
  const body = downloadSchema.parse(raw);
  const result = await withHostClient(params.id, session.user, async (client, host) => {
    const upid = await client.nodes.downloadAppliance(body.node, body.storage, body.template);
    if (!upid) throw new ValidationError("Proxmox hat keinen Download-Task zurückgegeben");
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
