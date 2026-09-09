import { apiRoute } from "@/server/http/api-route";
import { json } from "@/server/http/respond";
import { withHostClient } from "@/server/services/host-service";
import { ValidationError } from "@/lib/errors";

export const GET = apiRoute(
  [
    "hosts.view",
    "vm.view",
    "lxc.view",
    "tasks.view",
    "vm.create",
    "lxc.create",
    "vm.delete",
    "lxc.delete",
    "vm.clone",
    "lxc.clone",
    "vm.migrate",
    "lxc.migrate",
    "vm.start",
    "lxc.start",
    "backup.view",
  ],
  async (req, session, params) => {
    const url = new URL(req.url);
    const node = url.searchParams.get("node")?.trim() ?? "";
    const upid = url.searchParams.get("upid")?.trim() ?? "";
    if (!node || !upid) throw new ValidationError("node und upid erforderlich");
    const start = Math.max(0, Number(url.searchParams.get("start") ?? 0) || 0);
    const limit = Math.min(5000, Math.max(50, Number(url.searchParams.get("limit") ?? 2000) || 2000));
    const data = await withHostClient(params.id, session.user, async (client) => {
      const [status, log] = await Promise.all([
        client.tasks.status(node, upid),
        client.tasks.log(node, upid, start, limit),
      ]);
      return { status, log };
    });
    return json(data);
  },
);
