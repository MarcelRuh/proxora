import { apiRoute } from "@/server/http/api-route";
import { json } from "@/server/http/respond";
import { NotFoundError } from "@/lib/errors";
import {
  communityScriptInstallCommand,
  communityScriptPageUrl,
  communityScriptRawUrl,
  isSafeCommunityScriptSlug,
} from "@/lib/community-scripts";
import { getCommunityScript } from "@/server/services/community-scripts";

export const GET = apiRoute("hosts.view", async (_req, _session, params) => {
  const slug = params.slug;
  if (!isSafeCommunityScriptSlug(slug)) throw new NotFoundError("Script not found");
  const script = await getCommunityScript(slug);
  if (!script) throw new NotFoundError("Script not found");
  return json({
    script,
    command: communityScriptInstallCommand(script.kind, script.slug),
    sourceUrl: communityScriptRawUrl(script.kind, script.slug),
    pageUrl: communityScriptPageUrl(script.slug),
  });
});
