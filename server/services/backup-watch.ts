import { failedTaskKind, guestTaskLabel } from "@/lib/backup-tasks";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { notifyTopic } from "@/server/notifications/dispatch";
import { clientForHost } from "@/server/services/host-service";
import type { ProxmoxTask } from "@/server/proxmox/types";

export const BACKUP_WATCH_INTERVAL_MS = 60_000;
export const BACKUP_WATCH_STARTUP_DELAY_MS = 20_000;

const seenFailedUpids = new Set<string>();
let primed = false;
let scheduled = false;
let running = false;
let timer: ReturnType<typeof setTimeout> | null = null;

function remember(upid: string) {
  seenFailedUpids.add(upid);
  if (seenFailedUpids.size <= 800) return;
  const keep = [...seenFailedUpids].slice(-400);
  seenFailedUpids.clear();
  for (const id of keep) seenFailedUpids.add(id);
}

export function rememberNotifiedUpid(upid: string | undefined) {
  if (upid) remember(upid);
}

export async function scanFailedBackupTasks(): Promise<number> {
  const hosts = await prisma.host.findMany({ orderBy: { name: "asc" } });
  const failed: Array<{ hostId: string; hostName: string; task: ProxmoxTask }> = [];

  for (const host of hosts) {
    if (host.connectionState === "OFFLINE" || host.connectionState === "MAINTENANCE") continue;
    try {
      const client = await clientForHost(host);
      const nodes = await client.nodes.list();
      const lists = await Promise.all(
        nodes.map((n) => client.tasks.list(n.node, { source: "all", limit: 80 }).catch(() => [] as ProxmoxTask[])),
      );
      for (const task of lists.flat()) {
        if (!failedTaskKind(task) || !task.upid) continue;
        failed.push({ hostId: host.id, hostName: host.name, task });
      }
    } catch (error) {
      logger.warn(
        { host: host.name, err: error instanceof Error ? error.message : error },
        "Backup task scan failed",
      );
    }
  }

  if (!primed) {
    for (const row of failed) remember(row.task.upid);
    primed = true;
    return 0;
  }

  let notified = 0;
  for (const row of failed) {
    const upid = row.task.upid;
    if (!upid || seenFailedUpids.has(upid)) continue;
    remember(upid);
    const kind = failedTaskKind(row.task);
    const guestId = String(row.task.id ?? "").trim();
    if (kind === "backup") {
      notifyTopic("backup.failed", {
        level: "error",
        title: "Backup fehlgeschlagen",
        message: `${guestId ? `Gast ${guestId}` : "vzdump"} auf ${row.hostName}: ${row.task.exitstatus ?? "unbekannt"}`,
        hostId: row.hostId,
        name: guestId || "vzdump",
        id: guestId || upid,
        host: row.hostName,
        node: row.task.node,
      });
    } else if (kind === "guest") {
      const label = guestTaskLabel(row.task.type);
      notifyTopic("task.failed", {
        level: "error",
        title: `${label} fehlgeschlagen`,
        message: `${guestId ? `Gast ${guestId}` : label} auf ${row.hostName}: ${row.task.exitstatus ?? "unbekannt"}`,
        hostId: row.hostId,
        name: guestId || label,
        id: guestId || upid,
        host: row.hostName,
        node: row.task.node,
      });
    }
    notified += 1;
  }
  return notified;
}

async function tick() {
  if (running) return;
  running = true;
  try {
    const notified = await scanFailedBackupTasks();
    if (notified) logger.info({ notified }, "Task failure notifications sent");
  } catch (error) {
    logger.warn({ err: error }, "Backup watch cycle failed");
  } finally {
    running = false;
    timer = setTimeout(() => {
      void tick();
    }, BACKUP_WATCH_INTERVAL_MS);
    timer.unref?.();
  }
}

export function startBackupWatchScheduler() {
  if (scheduled) return;
  scheduled = true;
  logger.info(
    { intervalMs: BACKUP_WATCH_INTERVAL_MS, startupDelayMs: BACKUP_WATCH_STARTUP_DELAY_MS },
    "Backup watch scheduler started",
  );
  const startup = setTimeout(() => {
    void tick();
  }, BACKUP_WATCH_STARTUP_DELAY_MS);
  startup.unref?.();
}

/** Tests only. */
export function resetBackupWatchState() {
  seenFailedUpids.clear();
  primed = false;
}
