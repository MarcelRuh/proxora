import { apiRoute } from "@/server/http/api-route";
import { json } from "@/server/http/respond";
import { SCRIPT_TYPE_IDS, type CommunityScriptKind } from "@/lib/community-scripts";
import { listCommunityScripts } from "@/server/services/community-scripts";

const KINDS = new Set<CommunityScriptKind | "all">([
  "all",
  ...(Object.keys(SCRIPT_TYPE_IDS) as CommunityScriptKind[]),
]);

export const GET = apiRoute("hosts.view", async (req) => {
  const url = new URL(req.url);
  const query = url.searchParams.get("q") ?? undefined;
  const categoryId = url.searchParams.get("category") ?? undefined;
  const kindRaw = url.searchParams.get("kind") ?? "all";
  const kind = KINDS.has(kindRaw as CommunityScriptKind | "all")
    ? (kindRaw as CommunityScriptKind | "all")
    : "all";
  const force = url.searchParams.get("refresh") === "1";
  const catalog = await listCommunityScripts({
    query,
    categoryId: categoryId || undefined,
    kind,
    force,
  });
  return json(catalog);
});
