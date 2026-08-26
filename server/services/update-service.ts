import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import type { SessionUser } from "@/server/auth/session";
import { listHosts, withHostClient } from "@/server/services/host-service";

export async function queueHostUpdate(hostId: string, user: SessionUser, refreshFirst = true) {
  const job = await prisma.job.create({
    data: {
      type: "host.update",
      hostId,
      status: "WAITING",
      createdById: user.id,
      payload: { refreshFirst },
    },
  });
  void runUpdateJob(job.id);
  return job;
}

export async function queueAllHostUpdates(user: SessionUser) {
  const hosts = await listHosts(user);
  const jobs = [];
  for (const host of hosts) {
    jobs.push(await queueHostUpdate(host.id, user, true));
  }
  return jobs;
}

async function runUpdateJob(jobId: string) {
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job || !job.hostId) return;
  await prisma.job.update({
    where: { id: jobId },
    data: { status: "RUNNING", startedAt: new Date() },
  });
  try {
    const host = await prisma.host.findUnique({ where: { id: job.hostId } });
    if (!host) throw new Error("Host disappeared");
    const syntheticUser: SessionUser = {
      id: job.createdById ?? "system",
      username: "system",
      email: "",
      role: { id: "system", slug: "super-admin", name: "System", permissions: [] },
      allowedHostIds: null,
    };
    const upid = await withHostClient(host.id, syntheticUser, async (client) => {
      const nodes = await client.nodes.list();
      const node = nodes[0]?.node;
      if (!node) throw new Error("No node found");
      await client.updates.refresh(node);
      return client.updates.upgrade(node);
    });
    await prisma.job.update({
      where: { id: jobId },
      data: { status: "SUCCESS", finishedAt: new Date(), result: { upid } },
    });
    logger.info({ hostId: job.hostId, upid }, "Host update started");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Update failed";
    await prisma.job.update({
      where: { id: jobId },
      data: { status: "FAILED", finishedAt: new Date(), error: message },
    });
    logger.error({ hostId: job.hostId, err: message }, "Host update failed");
  }
}

export async function listJobs(type?: string) {
  return prisma.job.findMany({
    where: type ? { type } : undefined,
    include: { host: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
}
