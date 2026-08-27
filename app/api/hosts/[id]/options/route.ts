import { apiRoute } from "@/server/http/api-route";
import { json } from "@/server/http/respond";
import { guestIpFromVmid } from "@/lib/create-ip";
import { nextSmallerVmid } from "@/lib/next-vmid";
import { collectUsedGuestIps } from "@/server/services/guest-ips";
import { networksForHostId } from "@/server/services/guest-ip-settings";
import { withHostClient } from "@/server/services/host-service";

export const GET = apiRoute(["vm.create", "lxc.create", "vm.clone", "lxc.clone"], async (req, session, params) => {
  const url = new URL(req.url);
  const node = url.searchParams.get("node");
  const networks = await networksForHostId(params.id);
  const data = await withHostClient(params.id, session.user, async (client) => {
    const nodes = await client.nodes.list();
    const selected = node ?? nodes[0]?.node;
    if (!selected) {
      return { nodes: [], nextid: null, storage: [], isos: [], templates: [], bridges: [], networks, usedIps: [], usedVmids: [] };
    }
    const [storage, network, fallbackNext, used] = await Promise.all([
      client.storage.list(selected),
      client.nodes.network(selected).catch(() => []),
      client.cluster.nextId().catch(() => null),
      collectUsedGuestIps(client),
    ]);
    const usedIpSet = new Set(used.ips);
    const defaultNet = networks[0]?.id ?? "192.168.178.0";
    const nextid =
      used.vmids.length > 0
        ? nextSmallerVmid(used.vmids, undefined, (id) => {
            const ip = guestIpFromVmid(defaultNet, id, networks);
            return Boolean(ip && usedIpSet.has(ip));
          })
        : (fallbackNext ?? nextSmallerVmid([]));
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
    return {
      nodes,
      nextid,
      storage,
      isos,
      templates,
      bridges,
      networks,
      usedIps: used.ips,
      usedVmids: used.vmids,
    };
  });
  return json(data);
});
