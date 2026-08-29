import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { notifyTopic } from "@/server/notifications/dispatch";
import { clientForHost } from "@/server/services/host-service";
import {
  applyDiskWatchState,
  diskUsagePercent,
  guestDiskKey,
  storageDiskKey,
  type DiskSample,
} from "@/lib/disk-alerts";

export const DISK_WATCH_INTERVAL_MS = 5 * 60_000;
export const DISK_WATCH_STARTUP_DELAY_MS = 45_000;

const notified = new Map<string, boolean>();
let scheduled = false;
let running = false;
let timer: ReturnType<typeof setTimeout> | null = null;

function remember(samples: DiskSample[]): number {
  let count = 0;
  for (const sample of samples) {
    const prev = notified.get(sample.key) ?? false;
    const next = applyDiskWatchState(prev, sample.percent);
    notified.set(sample.key, next.notified);
    if (!next.notify) continue;
    count += 1;
    const pct = sample.percent.toLocaleString("de-DE", { maximumFractionDigits: 1 });
    const kindLabel =
      sample.kind === "storage" ? "Storage" : sample.guestKind === "lxc" ? "Container" : "VM";
    notifyTopic("disk.full", {
      level: "warning",
      title: `${kindLabel} ${Math.round(sample.percent)} % voll`,
      message: `${sample.name} auf ${sample.hostName}: ${pct} % belegt`,
      hostId: sample.hostId,
      name: sample.name,
      id: sample.id ?? sample.key,
      host: sample.hostName,
      node: sample.node,
    });
  }
  return count;
}

export async function scanDiskUsage(): Promise<number> {
  const hosts = await prisma.host.findMany({ orderBy: { name: "asc" } });
  const samples: DiskSample[] = [];

  for (const host of hosts) {
    if (host.connectionState === "OFFLINE" || host.connectionState === "MAINTENANCE") continue;
    try {
      const client = await clientForHost(host);
      const nodes = await client.nodes.list();
      const guests = await client.listGuests().catch(() => ({ vms: [], containers: [] }));

      await Promise.all(
        nodes.map(async (n) => {
          const list = await client.storage.list(n.node).catch(() => []);
          for (const storage of list) {
            const percent = diskUsagePercent(storage.used, storage.total);
            if (percent == null) continue;
            samples.push({
              key: storageDiskKey(host.id, n.node, storage.storage),
              kind: "storage",
              name: storage.storage,
              percent,
              hostId: host.id,
              hostName: host.name,
              node: n.node,
              id: storage.storage,
            });
          }
        }),
      );

      for (const guest of guests.vms) {
        if (guest.template || !guest.vmid) continue;
        const percent = diskUsagePercent(guest.disk, guest.maxdisk);
        if (percent == null) continue;
        samples.push({
          key: guestDiskKey(host.id, "vm", guest.vmid),
          kind: "guest",
          guestKind: "vm",
          name: guest.name || `VM ${guest.vmid}`,
          percent,
          hostId: host.id,
          hostName: host.name,
          node: guest.node,
          id: String(guest.vmid),
        });
      }
      for (const guest of guests.containers) {
        if (guest.template || !guest.vmid) continue;
        const percent = diskUsagePercent(guest.disk, guest.maxdisk);
        if (percent == null) continue;
        samples.push({
          key: guestDiskKey(host.id, "lxc", guest.vmid),
          kind: "guest",
          guestKind: "lxc",
          name: guest.name || `CT ${guest.vmid}`,
          percent,
          hostId: host.id,
          hostName: host.name,
          node: guest.node,
          id: String(guest.vmid),
        });
      }
    } catch (error) {
      logger.warn(
        { host: host.name, err: error instanceof Error ? error.message : error },
        "Disk usage scan failed",
      );
    }
  }

  return remember(samples);
}

async function tick() {
  if (running) return;
  running = true;
  try {
    const notifiedCount = await scanDiskUsage();
    if (notifiedCount) logger.info({ notified: notifiedCount }, "Disk usage notifications sent");
  } catch (error) {
    logger.warn({ err: error }, "Disk watch cycle failed");
  } finally {
    running = false;
    timer = setTimeout(() => {
      void tick();
    }, DISK_WATCH_INTERVAL_MS);
    timer.unref?.();
  }
}

export function startDiskWatchScheduler() {
  if (scheduled) return;
  scheduled = true;
  logger.info(
    { intervalMs: DISK_WATCH_INTERVAL_MS, startupDelayMs: DISK_WATCH_STARTUP_DELAY_MS },
    "Disk watch scheduler started",
  );
  const startup = setTimeout(() => {
    void tick();
  }, DISK_WATCH_STARTUP_DELAY_MS);
  startup.unref?.();
}

/** Tests only. */
export function resetDiskWatchState() {
  notified.clear();
}
