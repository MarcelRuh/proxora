import { mapPool } from "@/lib/async-pool";
import type { SessionUser } from "@/server/auth/session";
import { listHosts, withHostClient } from "@/server/services/host-service";
import { filterGuestsForUser } from "@/server/auth/session-core";
import { loadHostInventory } from "@/server/services/inventory-cache";
import { userHasPermission } from "@/lib/permissions";

const SEARCH_HOST_CONCURRENCY = 3;
const SEARCH_HIT_LIMIT = 20;

export async function globalSearch(user: SessionUser, query: string) {
  const q = query.trim().toLowerCase();
  if (q.length < 1) return { hosts: [], vms: [], containers: [], storage: [], tasks: [], users: [] };

  const hosts = await listHosts(user);
  const hostHits = userHasPermission(user, "hosts.view")
    ? hosts
        .filter((h) => h.name.toLowerCase().includes(q) || h.url.toLowerCase().includes(q))
        .slice(0, SEARCH_HIT_LIMIT)
        .map((h) => ({ type: "host" as const, id: h.id, title: h.name, subtitle: h.url }))
    : [];

  // Short queries: host names only — avoid inventory fan-out on every keystroke.
  if (q.length < 2) {
    return { hosts: hostHits, vms: [], containers: [], storage: [], tasks: [], users: [] };
  }

  const guestHits = await mapPool(hosts, SEARCH_HOST_CONCURRENCY, async (host) => {
    if (host.connectionState === "OFFLINE" || host.connectionState === "MAINTENANCE") {
      return { vms: [], containers: [], storage: [] };
    }
    try {
      return await withHostClient(host.id, user, async (client) => {
        const inv = await loadHostInventory(client, host.id);
        const seenStorage = new Set<string>();
        return {
          vms: filterGuestsForUser(user, host.id, "vm", inv.vms)
            .filter((v) => v.name.toLowerCase().includes(q) || String(v.vmid).includes(q))
            .slice(0, SEARCH_HIT_LIMIT)
            .map((v) => ({
              type: "vm" as const,
              id: `${host.id}:${v.node}:${v.vmid}`,
              title: `VM ${v.vmid} — ${v.name}`,
              subtitle: userHasPermission(user, "hosts.view") ? `${host.name} / ${v.node}` : undefined,
              href: `/vms/${host.id}/${v.node}/${v.vmid}`,
            })),
          containers: filterGuestsForUser(user, host.id, "lxc", inv.containers)
            .filter((v) => v.name.toLowerCase().includes(q) || String(v.vmid).includes(q))
            .slice(0, SEARCH_HIT_LIMIT)
            .map((v) => ({
              type: "lxc" as const,
              id: `${host.id}:${v.node}:${v.vmid}`,
              title: `LXC ${v.vmid} — ${v.name}`,
              subtitle: userHasPermission(user, "hosts.view") ? `${host.name} / ${v.node}` : undefined,
              href: `/containers/${host.id}/${v.node}/${v.vmid}`,
            })),
          storage: userHasPermission(user, "storage.view")
            ? inv.storage.flatMap((s) => {
                const name = s.storage.trim();
                if (!name || seenStorage.has(name) || !name.toLowerCase().includes(q)) return [];
                seenStorage.add(name);
                return [
                  {
                    type: "storage" as const,
                    id: `${host.id}:${name}`,
                    title: name,
                    subtitle: `${host.name} · ${s.type}`,
                    href: `/storage?host=${host.id}`,
                  },
                ];
              }).slice(0, SEARCH_HIT_LIMIT)
            : [],
        };
      });
    } catch {
      return { vms: [], containers: [], storage: [] };
    }
  });

  return {
    hosts: hostHits,
    vms: guestHits.flatMap((g) => g.vms).slice(0, SEARCH_HIT_LIMIT),
    containers: guestHits.flatMap((g) => g.containers).slice(0, SEARCH_HIT_LIMIT),
    storage: guestHits.flatMap((g) => g.storage).slice(0, SEARCH_HIT_LIMIT),
    tasks: [],
    users: [],
  };
}
