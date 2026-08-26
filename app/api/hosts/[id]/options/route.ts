import { apiRoute } from "@/server/http/api-route";
import { json } from "@/server/http/respond";
import { withHostClient } from "@/server/services/host-service";

export const GET = apiRoute(["vm.create", "lxc.create"], async (req, session, params) => {
  const url = new URL(req.url);
  const node = url.searchParams.get("node");
  const data = await withHostClient(params.id, session.user, async (client) => {
    const nodes = await client.nodes.list();
    const selected = node ?? nodes[0]?.node;
    if (!selected) return { nodes: [], nextid: null, storage: [], isos: [], templates: [], bridges: [] };
    const [nextid, storage, network] = await Promise.all([
      client.cluster.nextId().catch(() => null),
      client.storage.list(selected),
      client.nodes.network(selected).catch(() => []),
    ]);
    const isoStorages = storage.filter((s) => (s.content ?? "").includes("iso"));
    const tmplStorages = storage.filter((s) => (s.content ?? "").includes("vztmpl"));
    const isos = (
      await Promise.all(
        isoStorages.map((s) => client.storage.content(selected, s.storage, "iso").catch(() => [])),
      )
    ).flat();
    const templates = (
      await Promise.all(
        tmplStorages.map((s) => client.storage.content(selected, s.storage, "vztmpl").catch(() => [])),
      )
    ).flat();
    const bridges = network.filter((n) => n.type === "bridge" || String(n.iface ?? "").startsWith("vmbr"));
    return { nodes, nextid, storage, isos, templates, bridges };
  });
  return json(data);
});
