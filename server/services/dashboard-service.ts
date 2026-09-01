import type { SessionUser } from "@/server/auth/session";
import { listHosts, withHostClient } from "@/server/services/host-service";
import { attachVmAgentDisks } from "@/server/services/guest-disk";
import { filterGuestsForUser } from "@/server/auth/session-core";
import { isClusterNodeOnline, minPositiveUptime, weightedCpuRatio } from "@/lib/cluster-metrics";
import type { ConnectionState } from "@/lib/types";
import type { GuestListItem, ProxmoxResource } from "@/server/proxmox/types";

export type HostOverview = {
  id: string;
  name: string;
  url: string;
  connectionState: ConnectionState;
  proxmoxVersion: string | null;
  lastError: string | null;
  clusterName: string | null;
  isClusterMember: boolean;
  cpu?: number;
  cpuCores?: number;
  memUsed?: number;
  memTotal?: number;
  diskUsed?: number;
  diskTotal?: number;
  uptime?: number;
  loadavg?: [string, string, string];
  nodeCount?: number;
  onlineNodes?: number;
};

type HostSnapshot = {
  overview: HostOverview;
  vms: GuestListItem[];
  containers: GuestListItem[];
};

function hostShell(
  host: {
    id: string;
    name: string;
    url: string;
    connectionState: ConnectionState;
    proxmoxVersion: string | null;
    lastError: string | null;
    clusterName: string | null;
    isClusterMember: boolean;
  },
  extra: Partial<HostOverview> = {},
): HostOverview {
  return {
    id: host.id,
    name: host.name,
    url: host.url,
    connectionState: host.connectionState,
    proxmoxVersion: host.proxmoxVersion,
    lastError: host.lastError,
    clusterName: host.clusterName,
    isClusterMember: host.isClusterMember,
    ...extra,
  };
}

function nodePool(nodes: ProxmoxResource[]): ProxmoxResource[] {
  const live = nodes.filter((n) => isClusterNodeOnline(n.status));
  return live.length ? live : nodes;
}

export async function getDashboard(user: SessionUser) {
  const hosts = await listHosts(user);
  const snapshots: HostSnapshot[] = await Promise.all(
    hosts.map(async (host): Promise<HostSnapshot> => {
      if (host.connectionState === "OFFLINE" || host.connectionState === "MAINTENANCE") {
        return { overview: hostShell(host), vms: [], containers: [] };
      }
      try {
        return await withHostClient(host.id, user, async (client) => {
          const inv = await client.listInventory();
          const pool = nodePool(inv.nodes);
          const cpuCores = pool.reduce((acc, n) => acc + (n.maxcpu ?? 0), 0) || undefined;
          const memUsed = pool.reduce((acc, n) => acc + (n.mem ?? 0), 0);
          const memTotal = pool.reduce((acc, n) => acc + (n.maxmem ?? 0), 0);
          const diskUsed = pool.reduce((acc, n) => acc + (n.disk ?? 0), 0);
          const diskTotal = pool.reduce((acc, n) => acc + (n.maxdisk ?? 0), 0);
          const onlineNodes = inv.nodes.filter((n) => isClusterNodeOnline(n.status)).length;
          const vms = await attachVmAgentDisks(
            client,
            filterGuestsForUser(user, host.id, "vm", inv.vms),
          );
          const containers = filterGuestsForUser(user, host.id, "lxc", inv.containers);
          return {
            overview: hostShell(host, {
              connectionState: "ONLINE",
              lastError: null,
              cpu: weightedCpuRatio(pool.map((n) => ({ cpu: n.cpu, maxcpu: n.maxcpu }))),
              cpuCores,
              memUsed,
              memTotal,
              diskUsed,
              diskTotal,
              uptime: minPositiveUptime(pool),
              nodeCount: inv.nodes.length,
              onlineNodes,
            }),
            vms,
            containers,
          };
        });
      } catch (error) {
        return {
          overview: hostShell(host, {
            connectionState: "ERROR",
            lastError: error instanceof Error ? error.message : (host.lastError ?? "Unable to connect"),
          }),
          vms: [],
          containers: [],
        };
      }
    }),
  );

  const overviews = snapshots.map((s) => s.overview);
  const allVms = snapshots.flatMap((s) => s.vms.map((vm) => ({ ...vm, hostId: s.overview.id, hostName: s.overview.name })));
  const allLxc = snapshots.flatMap((s) =>
    s.containers.map((ct) => ({ ...ct, hostId: s.overview.id, hostName: s.overview.name })),
  );

  const online = overviews.filter((h) => h.connectionState === "ONLINE").length;
  const offline = overviews.filter((h) => h.connectionState === "OFFLINE").length;
  const warning = overviews.filter(
    (h) => h.connectionState === "ERROR" || h.connectionState === "MAINTENANCE",
  ).length;

  const memUsed = overviews.reduce((acc, h) => acc + (h.memUsed ?? 0), 0);
  const memTotal = overviews.reduce((acc, h) => acc + (h.memTotal ?? 0), 0);
  const diskUsed = overviews.reduce((acc, h) => acc + (h.diskUsed ?? 0), 0);
  const diskTotal = overviews.reduce((acc, h) => acc + (h.diskTotal ?? 0), 0);

  return {
    hosts: {
      total: overviews.length,
      online,
      offline,
      warning,
      items: overviews,
    },
    virtualization: {
      vms: allVms.length,
      lxc: allLxc.length,
      running: [...allVms, ...allLxc].filter((g) => g.status === "running").length,
      stopped: [...allVms, ...allLxc].filter((g) => g.status === "stopped").length,
      paused: [...allVms, ...allLxc].filter((g) => g.status === "paused").length,
    },
    resources: {
      cpu: weightedCpuRatio(overviews.map((h) => ({ cpu: h.cpu, maxcpu: h.cpuCores }))) ?? 0,
      memUsed,
      memTotal,
      diskUsed,
      diskTotal,
    },
    guests: { vms: allVms, containers: allLxc },
  };
}
