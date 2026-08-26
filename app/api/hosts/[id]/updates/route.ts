import { z } from "zod";
import { apiRoute } from "@/server/http/api-route";
import { json } from "@/server/http/respond";
import { clientIp } from "@/server/auth/session";
import { writeAuditLog } from "@/server/services/audit-service";
import { AUDIT_ACTIONS } from "@/lib/audit-actions";
import { withHostClient } from "@/server/services/host-service";
import { queueHostUpdate } from "@/server/services/update-service";

const bodySchema = z.object({
  action: z.enum(["check", "upgrade"]),
  node: z.string().optional(),
  confirm: z.boolean().optional(),
});

export const GET = apiRoute("updates.view", async (_req, session, params) => {
  const data = await withHostClient(params.id, session.user, async (client, host) => {
    const nodes = await client.nodes.list();
    const updates = await Promise.all(
      nodes.map(async (n) => {
        const packages = await client.updates.list(n.node).catch(() => []);
        return { node: n.node, packages, count: packages.length };
      }),
    );
    return { version: host.proxmoxVersion, updates };
  });
  return json(data);
});

export const POST = apiRoute("updates.execute", async (req, session, params) => {
  const body = bodySchema.parse(await req.json());
  if (body.action === "check") {
    const data = await withHostClient(params.id, session.user, async (client) => {
      const nodes = await client.nodes.list();
      const target = body.node ? nodes.filter((n) => n.node === body.node) : nodes;
      await Promise.all(target.map((n) => client.updates.refresh(n.node)));
      const updates = await Promise.all(
        target.map(async (n) => {
          const packages = await client.updates.list(n.node);
          return { node: n.node, packages, count: packages.length };
        }),
      );
      return { updates };
    });
    return json(data);
  }
  if (body.confirm !== true) {
    const { ValidationError } = await import("@/lib/errors");
    throw new ValidationError("Confirmation required for host updates");
  }
  const job = await queueHostUpdate(params.id, session.user, true);
  await writeAuditLog({
    userId: session.user.id,
    ip: await clientIp(),
    action: AUDIT_ACTIONS.UPDATE_STARTED,
    target: params.id,
    hostId: params.id,
    result: "SUCCESS",
    metadata: { jobId: job.id },
  });
  return json({ job });
});
