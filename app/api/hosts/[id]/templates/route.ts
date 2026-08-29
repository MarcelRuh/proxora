import { z } from "zod";
import { apiRoute } from "@/server/http/api-route";
import { json } from "@/server/http/respond";
import { clientIp } from "@/server/auth/session";
import { writeAuditLog } from "@/server/services/audit-service";
import { AUDIT_ACTIONS } from "@/lib/audit-actions";
import { withHostClient } from "@/server/services/host-service";
import { ValidationError } from "@/lib/errors";
import { mergeTemplateCatalog, normalizeAplTemplate, vztmplVolid } from "@/lib/lxc-templates";
import { collectVztmplVolumes } from "@/server/services/lxc-template-catalog";

export const GET = apiRoute("lxc.create", async (req, session, params) => {
  const nodeParam = new URL(req.url).searchParams.get("node")?.trim() || undefined;
  const data = await withHostClient(params.id, session.user, async (client) => {
    const nodes = await client.nodes.list();
    const selected = nodeParam ?? nodes[0]?.node;
    if (!selected) {
      return { nodes: [], node: "", storages: [], installed: [] as string[], catalog: [] };
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
    return {
      nodes: nodeNames,
      node: selected,
      storages: volumes.storages,
      installed: volumes.volids,
      catalog,
    };
  });
  return json(data);
});

const downloadSchema = z.object({
  node: z.string().min(1, "Node fehlt"),
  storage: z.string().min(1, "Storage fehlt"),
  template: z.string().min(1, "Template fehlt"),
});

export const POST = apiRoute("lxc.create", async (req, session, params) => {
  const body = downloadSchema.parse(await req.json());
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
