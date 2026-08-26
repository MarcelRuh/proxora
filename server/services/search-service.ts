import type { SessionUser } from "@/server/auth/session";
import { listHosts, withHostClient } from "@/server/services/host-service";

export async function globalSearch(user: SessionUser, query: string) {
  const q = query.trim().toLowerCase();
  if (q.length < 1) return { hosts: [], vms: [], containers: [], storage: [], tasks: [], users: [] };

  const hosts = await listHosts(user);
  const hostHits = hosts
    .filter((h) => h.name.toLowerCase().includes(q) || h.url.toLowerCase().includes(q))
    .map((h) => ({ type: "host" as const, id: h.id, title: h.name, subtitle: h.url }));

  const guestHits = await Promise.all(
    hosts.map(async (host) => {
      try {
        return await withHostClient(host.id, user, async (client) => {
          const [vms, containers, storage] = await Promise.all([
            client.listVms().catch(() => []),
            client.listContainers().catch(() => []),
            client.storage.list().catch(() => []),
          ]);
          return {
            vms: vms
              .filter((v) => v.name.toLowerCase().includes(q) || String(v.vmid).includes(q))
              .map((v) => ({
                type: "vm" as const,
                id: `${host.id}:${v.node}:${v.vmid}`,
                title: `VM ${v.vmid} — ${v.name}`,
                subtitle: `${host.name} / ${v.node}`,
                href: `/vms/${host.id}/${v.node}/${v.vmid}`,
              })),
            containers: containers
              .filter((v) => v.name.toLowerCase().includes(q) || String(v.vmid).includes(q))
              .map((v) => ({
                type: "lxc" as const,
                id: `${host.id}:${v.node}:${v.vmid}`,
                title: `LXC ${v.vmid} — ${v.name}`,
                subtitle: `${host.name} / ${v.node}`,
                href: `/containers/${host.id}/${v.node}/${v.vmid}`,
              })),
            storage: storage
              .filter((s) => s.storage.toLowerCase().includes(q))
              .map((s) => ({
                type: "storage" as const,
                id: `${host.id}:${s.storage}`,
                title: s.storage,
                subtitle: `${host.name} · ${s.type}`,
                href: `/storage?host=${host.id}`,
              })),
          };
        });
      } catch {
        return { vms: [], containers: [], storage: [] };
      }
    }),
  );

  return {
    hosts: hostHits,
    vms: guestHits.flatMap((g) => g.vms),
    containers: guestHits.flatMap((g) => g.containers),
    storage: guestHits.flatMap((g) => g.storage),
    tasks: [],
    users: [],
  };
}
