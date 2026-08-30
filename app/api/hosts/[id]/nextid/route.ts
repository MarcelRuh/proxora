import { apiRoute } from "@/server/http/api-route";
import { json } from "@/server/http/respond";
import { nextSmallerVmid } from "@/lib/next-vmid";
import { withHostClient } from "@/server/services/host-service";

export const GET = apiRoute(["vm.create", "lxc.create", "vm.clone", "lxc.clone"], async (_req, session, params) => {
  const nextid = await withHostClient(params.id, session.user, async (client) => {
    const [guests, fallbackNext] = await Promise.all([
      client.listGuests().catch(() => ({ vms: [], containers: [] })),
      client.cluster.nextId().catch(() => null),
    ]);
    const usedVmids = [...guests.vms, ...guests.containers]
      .map((g) => g.vmid)
      .filter((id) => Number.isInteger(id) && id > 0);
    return usedVmids.length > 0 ? nextSmallerVmid(usedVmids) : (fallbackNext ?? nextSmallerVmid([]));
  });
  return json({ nextid });
});
