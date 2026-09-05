import { apiRoute } from "@/server/http/api-route";
import { json } from "@/server/http/respond";
import { nextSmallerVmid } from "@/lib/next-vmid";
import { collectUsedVmidsForHost } from "@/server/services/guest-ips";
import { withHostClient } from "@/server/services/host-service";

export const GET = apiRoute(["vm.create", "lxc.create", "vm.clone", "lxc.clone"], async (_req, session, params) => {
  const nextid = await withHostClient(params.id, session.user, async (client, host) => {
    const [usedVmids, fallbackNext] = await Promise.all([
      collectUsedVmidsForHost(host),
      client.cluster.nextId().catch(() => null),
    ]);
    return usedVmids.length > 0 ? nextSmallerVmid(usedVmids) : (fallbackNext ?? nextSmallerVmid([]));
  });
  return json({ nextid });
});
