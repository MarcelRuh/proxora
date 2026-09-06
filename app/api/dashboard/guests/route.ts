import { apiRoute } from "@/server/http/api-route";
import { json } from "@/server/http/respond";
import { INVENTORY_VIEW_PERMISSIONS } from "@/lib/permissions";
import { getDashboardGuests } from "@/server/services/dashboard-service";

export const GET = apiRoute(INVENTORY_VIEW_PERMISSIONS, async (req, session) => {
  const kind = new URL(req.url).searchParams.get("kind");
  const parsed = kind === "vm" || kind === "lxc" ? kind : "all";
  return json(await getDashboardGuests(session.user, parsed));
});
