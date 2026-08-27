import { prisma } from "@/lib/db";
import type { SessionUser } from "@/server/auth/session";
import { withHostClient } from "@/server/services/host-service";

export type NodeUpdates = {
  node: string;
  packages: Array<{ Package: string; Version?: string; OldVersion?: string; Title?: string }>;
  count: number;
};

async function nodesFor(client: { nodes: { list: () => Promise<Array<{ node: string }>> } }, node?: string) {
  const nodes = await client.nodes.list();
  return node ? nodes.filter((n) => n.node === node) : nodes;
}

export async function listHostUpdates(hostId: string, user: SessionUser, node?: string) {
  return withHostClient(hostId, user, async (client, host) => {
    const nodes = await nodesFor(client, node);
    const updates: NodeUpdates[] = await Promise.all(
      nodes.map(async (n) => {
        const packages = await client.updates.list(n.node);
        return { node: n.node, packages, count: packages.length };
      }),
    );
    return { version: host.proxmoxVersion, updates };
  });
}

export async function refreshHostUpdates(hostId: string, user: SessionUser, node?: string) {
  return withHostClient(hostId, user, async (client, host) => {
    const nodes = await nodesFor(client, node);
    if (nodes.length === 0) throw new Error("Kein Node gefunden");
    const updates: NodeUpdates[] = [];
    for (const n of nodes) {
      const upid = await client.updates.refresh(n.node);
      if (upid) await client.tasks.wait(n.node, upid);
      const packages = await client.updates.list(n.node);
      updates.push({ node: n.node, packages, count: packages.length });
    }
    return { version: host.proxmoxVersion, updates };
  });
}

export async function upgradeConsoleTarget(hostId: string, user: SessionUser, node?: string) {
  return withHostClient(hostId, user, async (client) => {
    const nodes = await nodesFor(client, node);
    const target = nodes[0]?.node;
    if (!target) throw new Error("Kein Node gefunden");
    return { mode: "console" as const, node: target };
  });
}

export async function listJobs(type?: string) {
  return prisma.job.findMany({
    where: type ? { type } : undefined,
    include: { host: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
}
