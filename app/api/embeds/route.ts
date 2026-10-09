import { INVENTORY_VIEW_PERMISSIONS, userHasAnyPermission, userHasPermission } from "@/lib/permissions";
import { apiRoute } from "@/server/http/api-route";
import { json } from "@/server/http/respond";
import { loadSuiteEmbeds, saveSuiteEmbeds } from "@/server/services/suite-embeds";

function canUseSuite(session: { user: Parameters<typeof userHasPermission>[0] }) {
  return (
    userHasAnyPermission(session.user, INVENTORY_VIEW_PERMISSIONS) ||
    userHasPermission(session.user, "settings.view")
  );
}

export const GET = apiRoute(null, async (_req, session) => {
  if (!canUseSuite(session)) return json({ apps: [] });
  return json(await loadSuiteEmbeds());
});

export const PATCH = apiRoute("settings.update", async (req) => {
  const body = (await req.json()) as { apps?: unknown };
  return json(await saveSuiteEmbeds(body));
});
