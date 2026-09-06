import { apiRoute } from "@/server/http/api-route";
import { json } from "@/server/http/respond";
import { withHostClient } from "@/server/services/host-service";
import { filterGuestsForUser } from "@/server/auth/session-core";
import { loadHostInventory } from "@/server/services/inventory-cache";

export const GET = apiRoute(["hosts.view", "vm.view", "lxc.view", "users.view"], async (_req, session, params) => {
  const data = await withHostClient(params.id, session.user, async (client) => {
    const inv = await loadHostInventory(client, params.id);
    return {
      vms: filterGuestsForUser(session.user, params.id, "vm", inv.vms),
      containers: filterGuestsForUser(session.user, params.id, "lxc", inv.containers),
    };
  });
  return json(data);
});
