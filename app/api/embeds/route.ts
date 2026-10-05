import { apiRoute } from "@/server/http/api-route";
import { json } from "@/server/http/respond";
import { loadSuiteEmbeds, saveSuiteEmbeds } from "@/server/services/suite-embeds";

export const GET = apiRoute(null, async () => {
  return json(await loadSuiteEmbeds());
});

export const PATCH = apiRoute("settings.update", async (req) => {
  const body = (await req.json()) as { apps?: unknown };
  return json(await saveSuiteEmbeds(body));
});
