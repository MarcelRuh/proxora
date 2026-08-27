import type { Host } from "@prisma/client";
import {
  APT_REFRESH_INTERVAL_MS,
  APT_REFRESH_STARTUP_DELAY_MS,
  shouldNotifyAptUpdates,
} from "@/lib/apt-updates";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { dispatchNotification } from "@/server/notifications/dispatch";
import { clientForHost } from "@/server/services/host-service";

export async function persistAptSnapshot(
  host: Pick<Host, "id" | "name" | "aptNotifiedCount">,
  count: number,
): Promise<{ notify: boolean; count: number; name: string }> {
  const notify = shouldNotifyAptUpdates(host.aptNotifiedCount, count);
  await prisma.host.update({
    where: { id: host.id },
    data: {
      aptUpdateCount: count,
      aptCheckedAt: new Date(),
      aptNotifiedCount: count,
    },
  });
  return { notify, count, name: host.name };
}

export async function notifyAptUpdates(
  alerts: Array<{ name: string; count: number; hostId?: string; node?: string; preview?: string }>,
): Promise<void> {
  for (const alert of alerts) {
    await dispatchNotification({
      topic: "host.updates",
      level: "warning",
      title: alert.count === 1 ? "1 Host-Update verfügbar" : `${alert.count} Host-Updates verfügbar`,
      message: alert.preview ? `${alert.count} Paket(e): ${alert.preview}` : `${alert.count} Paket(e) auf ${alert.name}`,
      hostId: alert.hostId,
      name: alert.name,
      id: alert.hostId,
      host: alert.name,
      node: alert.node,
    });
  }
}

async function refreshOneHost(host: Host): Promise<{ count: number; preview: string[]; nodes: string[] }> {
  const client = await clientForHost(host);
  const nodes = await client.nodes.list();
  let count = 0;
  const preview: string[] = [];
  for (const n of nodes) {
    const upid = await client.updates.refresh(n.node);
    if (upid) await client.tasks.wait(n.node, upid);
    const packages = await client.updates.list(n.node);
    count += packages.length;
    for (const pkg of packages) {
      if (preview.length < 8 && pkg.Package) preview.push(pkg.Package);
    }
  }
  return { count, preview, nodes: nodes.map((n) => n.node) };
}

export async function refreshAllHostPackageLists(): Promise<{
  hosts: number;
  failed: number;
  notified: number;
}> {
  const hosts = await prisma.host.findMany({ orderBy: { name: "asc" } });
  const alerts: Array<{ name: string; count: number; hostId?: string; node?: string; preview?: string }> = [];
  let failed = 0;
  for (const host of hosts) {
    try {
      const { count, preview, nodes } = await refreshOneHost(host);
      const result = await persistAptSnapshot(host, count);
      if (result.notify) {
        alerts.push({
          name: host.name,
          count,
          hostId: host.id,
          node: nodes.join(", ") || undefined,
          preview: preview.length ? preview.join(", ") : undefined,
        });
      }
      logger.info({ host: host.name, count }, "APT package list refreshed");
    } catch (error) {
      failed += 1;
      logger.warn(
        { host: host.name, err: error instanceof Error ? error.message : error },
        "APT package list refresh failed",
      );
    }
  }
  await notifyAptUpdates(alerts);
  return { hosts: hosts.length, failed, notified: alerts.length };
}

let scheduled = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let running = false;

async function tick() {
  if (running) {
    logger.info("APT refresh already running, skip");
    return;
  }
  running = true;
  try {
    await refreshAllHostPackageLists();
  } catch (error) {
    logger.warn({ err: error }, "APT refresh cycle failed");
  } finally {
    running = false;
    timer = setTimeout(() => {
      void tick();
    }, APT_REFRESH_INTERVAL_MS);
    timer.unref?.();
  }
}

export function startAptRefreshScheduler() {
  if (scheduled) return;
  scheduled = true;
  logger.info(
    { intervalHours: APT_REFRESH_INTERVAL_MS / 3_600_000, startupDelayMs: APT_REFRESH_STARTUP_DELAY_MS },
    "APT refresh scheduler started",
  );
  const startup = setTimeout(() => {
    void tick();
  }, APT_REFRESH_STARTUP_DELAY_MS);
  startup.unref?.();
}
