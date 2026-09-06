import { apiRoute } from "@/server/http/api-route";
import { json } from "@/server/http/respond";
import { networksForHostId } from "@/server/services/guest-ip-settings";
import { getHostOrThrow, withHostClient } from "@/server/services/host-service";
import { loadCreateIdentity, loadCreateMedia, loadCreateShell } from "@/server/services/create-options";

export const GET = apiRoute(["vm.create", "lxc.create", "vm.clone", "lxc.clone"], async (req, session, params) => {
  const url = new URL(req.url);
  const node = url.searchParams.get("node")?.trim() || undefined;
  const media = url.searchParams.get("media") === "1";
  const ips = url.searchParams.get("ips") === "1";
  const networks = await networksForHostId(params.id);
  const target = await getHostOrThrow(params.id, session.user);

  if (ips && !media) {
    const identity = await loadCreateIdentity(target, networks, true);
    return json({
      nodes: [],
      nextid: identity.nextid,
      storage: [],
      isos: [],
      templates: [],
      bridges: [],
      networks,
      usedIps: identity.usedIps,
      usedVmids: identity.usedVmids,
    });
  }

  const [shell, identity, catalog] = await Promise.all([
    withHostClient(params.id, session.user, (client) => loadCreateShell(client, params.id, node)),
    loadCreateIdentity(target, networks, false),
    media
      ? withHostClient(params.id, session.user, (client) => loadCreateMedia(client, params.id, node))
      : Promise.resolve({ isos: [] as Array<{ volid: string }>, templates: [] as Array<{ volid: string }> }),
  ]);

  return json({
    nodes: shell.nodes,
    nextid: identity.nextid,
    storage: shell.storage,
    isos: catalog.isos,
    templates: catalog.templates,
    bridges: shell.bridges,
    networks,
    usedIps: [] as string[],
    usedVmids: identity.usedVmids,
  });
});
