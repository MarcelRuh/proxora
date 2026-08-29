import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { notifyTopic } from "@/server/notifications/dispatch";
import { summarizeZfsPool } from "@/server/proxmox/zfs-health";
import { clientForHost } from "@/server/services/host-service";
import { applyZfsWatchState, parseZfsWatchState, ZFS_WATCH_STATE_KEY, zfsPoolKey } from "@/lib/zfs-alerts";
import type { Prisma } from "@prisma/client";

export const ZFS_WATCH_INTERVAL_MS = 5 * 60_000;
export const ZFS_WATCH_STARTUP_DELAY_MS = 70_000;

let scheduled = false;
let running = false;
let timer: ReturnType<typeof setTimeout> | null = null;

async function loadState() {
  const row = await prisma.setting.findUnique({ where: { key: ZFS_WATCH_STATE_KEY } });
  return parseZfsWatchState(row?.value);
}

async function saveState(notified: Record<string, boolean>) {
  const value = { notified } as unknown as Prisma.InputJsonValue;
  await prisma.setting.upsert({
    where: { key: ZFS_WATCH_STATE_KEY },
    update: { value },
    create: { key: ZFS_WATCH_STATE_KEY, value },
  });
}

export async function scanZfsHealth(): Promise<number> {
  const hosts = await prisma.host.findMany({ orderBy: { name: "asc" } });
  const nextNotified: Record<string, boolean> = {};
  const prev = (await loadState()).notified;
  let count = 0;

  for (const host of hosts) {
    if (host.connectionState === "OFFLINE" || host.connectionState === "MAINTENANCE") continue;
    try {
      const client = await clientForHost(host);
      const nodes = await client.nodes.list();
      for (const n of nodes) {
        const pools = await client.zfs.pools(n.node).catch(() => []);
        for (const pool of pools) {
          const detail = await client.zfs.poolDetail(n.node, pool.name).catch(() => null);
          const summary = summarizeZfsPool(detail, pool.health);
          const key = zfsPoolKey(host.id, n.node, pool.name);
          const was = prev[key] ?? false;
          const next = applyZfsWatchState(was, summary.allHealthy);
          nextNotified[key] = next.notified;
          if (!next.notify) continue;
          count += 1;
          const problems = summary.problemDisks;
          notifyTopic("zfs.degraded", {
            level: summary.problemDisks ? "warning" : "error",
            title: `ZFS ${pool.name} ${pool.health || "DEGRADED"}`,
            message: `${pool.name} auf ${host.name}/${n.node}: ${problems}/${summary.totalDisks || "?"} Disk(s) nicht OK`,
            hostId: host.id,
            name: pool.name,
            id: pool.name,
            host: host.name,
            node: n.node,
            href: "/zfs",
          });
        }
      }
    } catch (error) {
      logger.warn({ host: host.name, err: error instanceof Error ? error.message : error }, "ZFS health scan failed");
    }
  }

  await saveState(nextNotified);
  return count;
}

async function tick() {
  if (running) return;
  running = true;
  try {
    const notified = await scanZfsHealth();
    if (notified) logger.info({ notified }, "ZFS health notifications sent");
  } catch (error) {
    logger.warn({ err: error }, "ZFS watch cycle failed");
  } finally {
    running = false;
    timer = setTimeout(() => {
      void tick();
    }, ZFS_WATCH_INTERVAL_MS);
    timer.unref?.();
  }
}

export function startZfsWatchScheduler() {
  if (scheduled) return;
  scheduled = true;
  logger.info({ intervalMs: ZFS_WATCH_INTERVAL_MS, startupDelayMs: ZFS_WATCH_STARTUP_DELAY_MS }, "ZFS watch scheduler started");
  const startup = setTimeout(() => {
    void tick();
  }, ZFS_WATCH_STARTUP_DELAY_MS);
  startup.unref?.();
}
