import { apiRoute } from "@/server/http/api-route";
import { json } from "@/server/http/respond";
import { guestIpFromVmid } from "@/lib/create-ip";
import { nextSmallerVmid } from "@/lib/next-vmid";
import { collectUsedGuestIpsAllHosts } from "@/server/services/guest-ips";
import { networksForHostId } from "@/server/services/guest-ip-settings";
import { collectVztmplVolumes } from "@/server/services/lxc-template-catalog";
import { withHostClient } from "@/server/services/host-service";

export const GET = apiRoute(["vm.create", "lxc.create", "vm.clone", "lxc.clone"], async (req, session, params) => {
  const url = new URL(req.url);
  const node = url.searchParams.get("node");
  const networks = await networksForHostId(params.id);
  const [used, hostData] = await Promise.all([
    collectUsedGuestIpsAllHosts(),
    withHostClient(params.id, session.user, async (client) => {
      const nodes = await client.nodes.list();
      const selected = node ?? nodes[0]?.node;
      if (!selected) {
        return {
          nodes: [],
          storage: [],
          isos: [],
          templates: [],
          bridges: [],
          fallbackNext: null as number | null,
        };
      }
      const [storage, network, fallbackNext] = await Promise.all([
        client.storage.list(selected),
        client.nodes.network(selected).catch(() => []),
        client.cluster.nextId().catch(() => null),
      ]);
      const isoStorages = storage.filter((s) => (s.content ?? "").includes("iso"));
      const nodeNames = nodes.map((n) => n.node);
      const [{ volids: templateVolids }, isoLists] = await Promise.all([
        collectVztmplVolumes(client, nodeNames),
        Promise.all(isoStorages.map((s) => client.storage.content(selected, s.storage, "iso").catch(() => []))),
      ]);
      const templates = templateVolids.map((volid) => ({ volid }));
      const isos = isoLists.flat();
      const bridges = network.filter((n) => n.type === "bridge" || String(n.iface ?? "").startsWith("vmbr"));
      return { nodes, storage, isos, templates, bridges, fallbackNext };
    }),
  ]);
  const usedIpSet = new Set(used.ips);
  const defaultNet = networks[0]?.id ?? "192.168.178.0";
  const nextid =
    used.vmids.length > 0
      ? nextSmallerVmid(used.vmids, undefined, (id) => {
          const ip = guestIpFromVmid(defaultNet, id, networks);
          return Boolean(ip && usedIpSet.has(ip));
        })
      : (hostData.fallbackNext ?? nextSmallerVmid([]));
  return json({
    nodes: hostData.nodes,
    nextid,
    storage: hostData.storage,
    isos: hostData.isos,
    templates: hostData.templates,
    bridges: hostData.bridges,
    networks,
    usedIps: used.ips,
    usedVmids: used.vmids,
  });
});
