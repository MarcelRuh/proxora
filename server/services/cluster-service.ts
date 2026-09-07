import { ValidationError } from "@/lib/errors";
import { haSid, hostShowsClusterUi } from "@/lib/cluster-features";
import type { ProxmoxClient } from "@/server/proxmox/client";
import type { Host } from "@prisma/client";

export function assertClusterHost(host: Pick<Host, "isClusterMember">) {
  if (!hostShowsClusterUi(host.isClusterMember)) {
    throw new ValidationError("Dieser Host ist kein Cluster-Mitglied");
  }
}

export async function loadClusterOverview(client: ProxmoxClient, host: Pick<Host, "isClusterMember" | "clusterName">) {
  if (!hostShowsClusterUi(host.isClusterMember)) {
    return {
      clustered: false as const,
      name: host.clusterName,
      quorate: null,
      nodes: [] as Array<{ name: string; online: boolean; ip?: string }>,
      haGroups: [] as Array<Record<string, unknown>>,
      replications: [] as Array<Record<string, unknown>>,
    };
  }
  const [status, haGroups, replications] = await Promise.all([
    client.cluster.status().catch(() => []),
    client.ha.groups().catch(() => []),
    client.replication.list().catch(() => []),
  ]);
  const cluster = status.find((row) => row.type === "cluster") as
    | { name?: string; quorate?: number; nodes?: number }
    | undefined;
  const nodes = status
    .filter((row) => row.type === "node")
    .map((row) => ({
      name: String(row.name ?? row.node ?? ""),
      online: row.online === 1 || row.online === true,
      ip: typeof row.ip === "string" ? row.ip : undefined,
    }))
    .filter((row) => row.name);
  return {
    clustered: true as const,
    name: cluster?.name ?? host.clusterName,
    quorate: cluster?.quorate === 1,
    nodes,
    haGroups: Array.isArray(haGroups) ? haGroups : [],
    replications: Array.isArray(replications) ? replications : [],
  };
}

export async function loadGuestHa(
  client: ProxmoxClient,
  host: Pick<Host, "isClusterMember">,
  kind: "vm" | "lxc",
  vmid: number,
) {
  if (!hostShowsClusterUi(host.isClusterMember)) {
    return { clustered: false as const, resource: null, groups: [] as Array<Record<string, unknown>> };
  }
  const sid = haSid(kind, vmid);
  const [resource, groups] = await Promise.all([
    client.ha.get(sid).catch(() => null),
    client.ha.groups().catch(() => []),
  ]);
  return {
    clustered: true as const,
    resource,
    groups: Array.isArray(groups) ? groups : [],
  };
}

export async function saveGuestHa(
  client: ProxmoxClient,
  host: Pick<Host, "isClusterMember">,
  kind: "vm" | "lxc",
  vmid: number,
  body: { enabled?: boolean; group?: string; state?: string; maxRestart?: number; maxRelocate?: number },
) {
  assertClusterHost(host);
  const sid = haSid(kind, vmid);
  if (body.enabled === false) {
    await client.ha.delete(sid).catch(() => undefined);
    return { ok: true, resource: null };
  }
  const payload: Record<string, unknown> = {};
  if (body.group !== undefined) payload.group = body.group || undefined;
  if (body.state) payload.state = body.state;
  if (body.maxRestart != null) payload.max_restart = body.maxRestart;
  if (body.maxRelocate != null) payload.max_relocate = body.maxRelocate;
  const existing = await client.ha.get(sid).catch(() => null);
  if (existing) {
    await client.ha.update(sid, payload);
  } else {
    await client.ha.create({ sid, ...payload });
  }
  return { ok: true, resource: await client.ha.get(sid).catch(() => null) };
}
