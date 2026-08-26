import type { SessionUser } from "@/server/auth/session";
import { listHosts, withHostClient } from "@/server/services/host-service";
import type { GuestListItem } from "@/server/proxmox/types";

export type HostOverview = {
  id: string;
  name: string;
  url: string;
  connectionState: string;
  proxmoxVersion: string | null;
  lastError: string | null;
  clusterName: string | null;
  isClusterMember: boolean;
  cpu?: number;
  memUsed?: number;
  memTotal?: number;
  diskUsed?: number;
  diskTotal?: number;
  uptime?: number;
  loadavg?: [string, string, string];
  nodeCount?: number;
  onlineNodes?: number;
};

export async function getDashboard(user: SessionUser) {
  const hosts = await listHosts(user);
  const overviews: HostOverview[] = await Promise.all(
    hosts.map(async (host) => {
      if (host.connectionState === "OFFLINE" || host.connectionState === "MAINTENANCE") {
        return {
          id: host.id,
          name: host.name,
          url: host.url,
          connectionState: host.connectionState,
          proxmoxVersion: host.proxmoxVersion,
          lastError: host.lastError,
          clusterName: host.clusterName,
          isClusterMember: host.isClusterMember,
        } satisfies HostOverview;
      }
      try {
        return await withHostClient(host.id, user, async (client) => {
          const nodes = await client.nodes.list();
          const primary = nodes[0];
          const status = primary
            ? await client.nodes.status(primary.node).catch(() => null)
            : null;
          return {
            id: host.id,
            name: host.name,
            url: host.url,
            connectionState: "ONLINE",
            proxmoxVersion: host.proxmoxVersion,
            lastError: null,
            clusterName: host.clusterName,
            isClusterMember: host.isClusterMember,
            cpu: status?.cpu,
            memUsed: status?.memory.used,
            memTotal: status?.memory.total,
            diskUsed: status?.rootfs?.used,
            diskTotal: status?.rootfs?.total,
            uptime: status?.uptime,
            loadavg: status?.loadavg,
            nodeCount: nodes.length,
            onlineNodes: nodes.filter((n) => n.status === "online").length,
          } satisfies HostOverview;
        });
      } catch {
        return {
          id: host.id,
          name: host.name,
          url: host.url,
          connectionState: "ERROR",
          proxmoxVersion: host.proxmoxVersion,
          lastError: host.lastError ?? "Unable to connect",
          clusterName: host.clusterName,
          isClusterMember: host.isClusterMember,
        } satisfies HostOverview;
      }
    }),
  );

  const guests = await Promise.all(
    hosts.map(async (host) => {
      try {
        return await withHostClient(host.id, user, async (client) => {
          const [vms, containers] = await Promise.all([
            client.listVms().catch(() => [] as GuestListItem[]),
            client.listContainers().catch(() => [] as GuestListItem[]),
          ]);
          return { hostId: host.id, hostName: host.name, vms, containers };
        });
      } catch {
        return { hostId: host.id, hostName: host.name, vms: [] as GuestListItem[], containers: [] as GuestListItem[] };
      }
    }),
  );

  const allVms = guests.flatMap((g) => g.vms.map((vm) => ({ ...vm, hostId: g.hostId, hostName: g.hostName })));
  const allLxc = guests.flatMap((g) =>
    g.containers.map((ct) => ({ ...ct, hostId: g.hostId, hostName: g.hostName })),
  );

  const online = overviews.filter((h) => h.connectionState === "ONLINE").length;
  const offline = overviews.filter((h) => h.connectionState === "OFFLINE").length;
  const warning = overviews.filter(
    (h) => h.connectionState === "ERROR" || h.connectionState === "MAINTENANCE",
  ).length;

  const cpuSamples = overviews.map((h) => h.cpu).filter((v): v is number => typeof v === "number");
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
      cpu: cpuSamples.reduce((acc, v) => acc + v, 0) / Math.max(1, cpuSamples.length),
      memUsed,
      memTotal,
      diskUsed,
      diskTotal,
    },
    guests: { vms: allVms, containers: allLxc },
  };
}
