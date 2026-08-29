import { z } from "zod";
import { apiRoute } from "@/server/http/api-route";
import { json } from "@/server/http/respond";
import { clientIp } from "@/server/auth/session";
import { writeAuditLog } from "@/server/services/audit-service";
import { AUDIT_ACTIONS } from "@/lib/audit-actions";
import { withHostClient } from "@/server/services/host-service";
import { taskGuestLabel, taskTypeLabel } from "@/lib/proxmox-tasks";

export const GET = apiRoute("tasks.view", async (req, session, params) => {
  const url = new URL(req.url);
  const node = url.searchParams.get("node");
  const data = await withHostClient(params.id, session.user, async (client) => {
    const nodes = node ? [{ node }] : await client.nodes.list();
    const [taskLists, guests] = await Promise.all([
      Promise.all(nodes.map((n) => client.tasks.list(n.node, { source: "all", limit: 80 }))),
      client.listGuests().catch(() => ({ vms: [], containers: [] })),
    ]);
    const names = new Map<string, { name: string; kind: "vm" | "lxc" }>();
    for (const guest of guests.vms) names.set(String(guest.vmid), { name: guest.name, kind: "vm" });
    for (const guest of guests.containers) names.set(String(guest.vmid), { name: guest.name, kind: "lxc" });
    const tasks = taskLists.flat().map((task) => {
      const match = names.get(String(task.id ?? "").trim());
      return {
        ...task,
        guestName: match?.name,
        guestKind: match?.kind,
      };
    });
    return { tasks };
  });
  return json(data);
});

const stopSchema = z.object({
  action: z.literal("stop"),
  node: z.string().min(1),
  upid: z.string().min(1),
});

export const POST = apiRoute("tasks.cancel", async (req, session, params) => {
  const body = stopSchema.parse(await req.json());
  await withHostClient(params.id, session.user, async (client, host) => {
    await client.tasks.stop(body.node, body.upid);
    const status = await client.tasks.status(body.node, body.upid).catch(() => null);
    await writeAuditLog({
      userId: session.user.id,
      ip: await clientIp(),
      action: AUDIT_ACTIONS.TASK_STOPPED,
      target: body.upid,
      hostId: params.id,
      result: "SUCCESS",
      metadata: {
        node: body.node,
        type: status?.type,
        id: status?.id,
        host: host.name,
        label: taskGuestLabel({ ...status, type: status?.type }) || taskTypeLabel(status?.type),
      },
    });
  });
  return json({ ok: true });
});
