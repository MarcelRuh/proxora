import type { SessionUser } from "@/server/auth/session";
import { listHosts, withHostClient } from "@/server/services/host-service";
import { applyCachedVmDisks } from "@/server/services/guest-disk";
import { applyCachedGuestIps, rememberGuestIps } from "@/server/services/guest-ip-cache";
import { loadHostInventory } from "@/server/services/inventory-cache";
import { canAccessGuest, filterGuestsForUser } from "@/server/auth/session-core";
import { userHasPermission } from "@/lib/permissions";
import { isClusterNodeOnline, minPositiveUptime, weightedCpuRatio } from "@/lib/cluster-metrics";
import { withTimeoutFallback } from "@/lib/promise-timeout";
import type { ConnectionState, Guest } from "@/lib/types";
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
  origin?: "LOCAL" | "PEER";
  peerName?: string | null;
};

type HostCounts = { vms: number; lxc: number; running: number; stopped: number; paused: number };

export const HOST_SNAPSHOT_TIMEOUT_MS = 3_000;
export const HOST_SNAPSHOT_TIMEOUT_PEER_MS = 8_000;
export const VISIBLE_GUEST_IP_LIMIT = 40;

export function hostSnapshotTimeoutMs(host: { origin?: string }): number {
  return host.origin === "PEER" ? HOST_SNAPSHOT_TIMEOUT_PEER_MS : HOST_SNAPSHOT_TIMEOUT_MS;
}

type HostSnapshot = {
  overview: HostOverview;
  counts: HostCounts;
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
    origin?: "LOCAL" | "PEER";
    peerName?: string | null;
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
    origin: host.origin,
    peerName: host.peerName,
    ...extra,
  };
}

function nodePool(nodes: ProxmoxResource[]): ProxmoxResource[] {
  const live = nodes.filter((n) => isClusterNodeOnline(n.status));
  return live.length ? live : nodes;
}

function guestCounts(vms: GuestListItem[], containers: GuestListItem[]): HostCounts {
  const all = [...vms, ...containers];
  return {
    vms: vms.length,
    lxc: containers.length,
    running: all.filter((g) => g.status === "running").length,
    stopped: all.filter((g) => g.status === "stopped").length,
    paused: all.filter((g) => g.status === "paused").length,
  };
}

function attachHost(
  snapshot: HostSnapshot,
  guests: GuestListItem[],
  revealHost: boolean,
): Array<Omit<Guest, "kind">> {
  return guests.map((guest) => ({
    ...guest,
    hostId: snapshot.overview.id,
    hostName: revealHost ? snapshot.overview.name : undefined,
    hostOwner: revealHost && snapshot.overview.origin === "PEER" ? snapshot.overview.peerName : null,
  }));
}

async function snapshotHost(
  host: Awaited<ReturnType<typeof listHosts>>[number],
  user: SessionUser,
  mode: "overview" | "guests",
): Promise<HostSnapshot> {
  const empty: HostSnapshot = { overview: hostShell(host), counts: guestCounts([], []), vms: [], containers: [] };
  if (host.connectionState === "OFFLINE" || host.connectionState === "MAINTENANCE") return empty;
  try {
    return await withHostClient(host.id, user, async (client) => {
      const inv = await loadHostInventory(client, host.id);
      const pool = nodePool(inv.nodes);
      const cpuCores = pool.reduce((acc, n) => acc + (n.maxcpu ?? 0), 0) || undefined;
      const memUsed = pool.reduce((acc, n) => acc + (n.mem ?? 0), 0);
      const memTotal = pool.reduce((acc, n) => acc + (n.maxmem ?? 0), 0);
      const diskUsed = pool.reduce((acc, n) => acc + (n.disk ?? 0), 0);
      const diskTotal = pool.reduce((acc, n) => acc + (n.maxdisk ?? 0), 0);
      const onlineNodes = inv.nodes.filter((n) => isClusterNodeOnline(n.status)).length;
      const filteredVms = filterGuestsForUser(user, host.id, "vm", inv.vms);
      const filteredLxc = filterGuestsForUser(user, host.id, "lxc", inv.containers);
      const overview = hostShell(host, {
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
      });
      if (mode === "overview") {
        return { overview, counts: guestCounts(filteredVms, filteredLxc), vms: [], containers: [] };
      }
      const vms = applyCachedGuestIps(client, "vm", applyCachedVmDisks(client, filteredVms));
      const containers = applyCachedGuestIps(client, "lxc", filteredLxc);
      return { overview, counts: guestCounts(vms, containers), vms, containers };
    });
  } catch (error) {
    return {
      overview: hostShell(host, {
        connectionState: "ERROR",
        lastError: error instanceof Error ? error.message : (host.lastError ?? "Unable to connect"),
      }),
      counts: guestCounts([], []),
      vms: [],
      containers: [],
    };
  }
}

function dashboardShell(snapshots: HostSnapshot[]) {
  const overviews = snapshots.map((s) => s.overview);
  const online = overviews.filter((h) => h.connectionState === "ONLINE").length;
  const offline = overviews.filter((h) => h.connectionState === "OFFLINE").length;
  const warning = overviews.filter((h) => h.connectionState === "ERROR" || h.connectionState === "MAINTENANCE").length;
  const memUsed = overviews.reduce((acc, h) => acc + (h.memUsed ?? 0), 0);
  const memTotal = overviews.reduce((acc, h) => acc + (h.memTotal ?? 0), 0);
  const diskUsed = overviews.reduce((acc, h) => acc + (h.diskUsed ?? 0), 0);
  const diskTotal = overviews.reduce((acc, h) => acc + (h.diskTotal ?? 0), 0);
  const virtualization = snapshots.reduce(
    (acc, s) => ({
      vms: acc.vms + s.counts.vms,
      lxc: acc.lxc + s.counts.lxc,
      running: acc.running + s.counts.running,
      stopped: acc.stopped + s.counts.stopped,
      paused: acc.paused + s.counts.paused,
    }),
    { vms: 0, lxc: 0, running: 0, stopped: 0, paused: 0 },
  );
  return {
    hosts: { total: overviews.length, online, offline, warning, items: overviews },
    virtualization,
    resources: {
      cpu: weightedCpuRatio(overviews.map((h) => ({ cpu: h.cpu, maxcpu: h.cpuCores }))) ?? 0,
      memUsed,
      memTotal,
      diskUsed,
      diskTotal,
    },
  };
}

async function snapshotHostTimed(
  host: Awaited<ReturnType<typeof listHosts>>[number],
  user: SessionUser,
  mode: "overview" | "guests",
): Promise<HostSnapshot> {
  const timedOut = (): HostSnapshot => ({
    overview: hostShell(host, {
      connectionState: "ERROR",
      lastError: host.lastError ?? "Host did not respond in time",
    }),
    counts: guestCounts([], []),
    vms: [],
    containers: [],
  });
  try {
    return await withTimeoutFallback(snapshotHost(host, user, mode), hostSnapshotTimeoutMs(host), timedOut);
  } catch (error) {
    return {
      overview: hostShell(host, {
        connectionState: "ERROR",
        lastError: error instanceof Error ? error.message : (host.lastError ?? "Unable to connect"),
      }),
      counts: guestCounts([], []),
      vms: [],
      containers: [],
    };
  }
}

export async function getDashboard(user: SessionUser) {
  const hosts = await listHosts(user);
  const snapshots = await Promise.all(hosts.map((host) => snapshotHostTimed(host, user, "overview")));
  return dashboardShell(snapshots);
}

export async function getDashboardGuests(user: SessionUser, kind: "vm" | "lxc" | "all" = "all") {
  const hosts = await listHosts(user);
  const snapshots = await Promise.all(hosts.map((host) => snapshotHostTimed(host, user, "guests")));
  const revealHost = userHasPermission(user, "hosts.view");
  const vms = kind === "lxc" ? [] : snapshots.flatMap((s) => attachHost(s, s.vms, revealHost));
  const containers = kind === "vm" ? [] : snapshots.flatMap((s) => attachHost(s, s.containers, revealHost));
  return { vms, containers };
}

export type GuestIpTarget = { hostId: string; node: string; vmid: number; kind: "vm" | "lxc" };

export async function hydrateVisibleGuestIps(user: SessionUser, targets: GuestIpTarget[]) {
  const capped = targets
    .filter((t) => t.hostId && t.node && t.vmid > 0 && (t.kind === "vm" || t.kind === "lxc"))
    .filter((t) => canAccessGuest(user, t.hostId, t.kind, t.vmid))
    .slice(0, VISIBLE_GUEST_IP_LIMIT);
  const byHost = new Map<string, GuestIpTarget[]>();
  for (const target of capped) {
    const list = byHost.get(target.hostId) ?? [];
    list.push(target);
    byHost.set(target.hostId, list);
  }
  const rows: Array<{ hostId: string; kind: "vm" | "lxc"; node: string; vmid: number; ips: string[] }> = [];
  await Promise.all(
    [...byHost.entries()].map(async ([hostId, group]) => {
      try {
        await withHostClient(hostId, user, async (client) => {
          const vms = group
            .filter((g) => g.kind === "vm")
            .map((g) => ({
              vmid: g.vmid,
              name: "",
              node: g.node,
              status: "running" as const,
              cpu: 0,
              cpus: 0,
              mem: 0,
              maxmem: 0,
              disk: 0,
              maxdisk: 0,
              uptime: 0,
              template: false,
            }));
          const containers = group
            .filter((g) => g.kind === "lxc")
            .map((g) => ({
              vmid: g.vmid,
              name: "",
              node: g.node,
              status: "running" as const,
              cpu: 0,
              cpus: 0,
              mem: 0,
              maxmem: 0,
              disk: 0,
              maxdisk: 0,
              uptime: 0,
              template: false,
            }));
          const [vmRows, lxcRows] = await Promise.all([
            rememberGuestIps(client, "vm", vms, { concurrency: 4, budgetMs: 3_000 }),
            rememberGuestIps(client, "lxc", containers, { concurrency: 4, budgetMs: 3_000 }),
          ]);
          for (const guest of vmRows) {
            rows.push({ hostId, kind: "vm", node: guest.node, vmid: guest.vmid, ips: guest.ips ?? [] });
          }
          for (const guest of lxcRows) {
            rows.push({ hostId, kind: "lxc", node: guest.node, vmid: guest.vmid, ips: guest.ips ?? [] });
          }
        });
      } catch {
        // skip unreachable host
      }
    }),
  );
  return { ips: rows };
}
