import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { durationLabel } from "@/lib/duration";
import { logger } from "@/lib/logger";
import { toSessionUser, type SessionUser } from "@/server/auth/session-core";
import { notifyTopic } from "@/server/notifications/dispatch";
import { TASK_TIMEOUT, isUpid, waitUpid } from "@/server/proxmox/task-wait";
import { restoreBackup } from "@/server/services/backup-service";
import { withHostClient } from "@/server/services/host-service";

const SETTING_KEY = "restore.jobs.v1";
const ERROR_TTL_MS = 15 * 60 * 1000;

export type RestoreJobView = {
  phase: "stopping" | "running" | "error";
  upid?: string;
  error?: string;
};

type RestoreInput = {
  userId: string;
  hostId: string;
  hostName: string;
  node: string;
  volid: string;
  vmid: number;
  storage: string;
  force?: boolean;
  startAfter?: boolean;
  name?: string;
};

type RestoreJob = RestoreJobView &
  RestoreInput & {
    id: string;
    attempt: number;
    startedAt: number;
    errorAt?: number;
  };

const jobs = new Map<string, RestoreJob>();
let persistChain: Promise<void> = Promise.resolve();

export function getRestoreJob(hostId: string, id: string): RestoreJobView | null {
  const job = jobs.get(id);
  if (!job || job.hostId !== hostId) return null;
  return { phase: job.phase, upid: job.upid, error: job.error };
}

export function enqueueRestoreJob(input: Omit<RestoreInput, "userId"> & { user: SessionUser }): string {
  const id = `restore-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const job: RestoreJob = {
    id,
    userId: input.user.id,
    hostId: input.hostId,
    hostName: input.hostName,
    node: input.node,
    volid: input.volid,
    vmid: input.vmid,
    storage: input.storage,
    force: input.force,
    startAfter: input.startAfter,
    name: input.name,
    phase: "stopping",
    attempt: 1,
    startedAt: Date.now(),
  };
  jobs.set(id, job);
  void persistJobs();
  void runRestoreJob(id, input.user);
  return id;
}

export async function resumeRestoreJobs(): Promise<void> {
  const row = await prisma.setting.findUnique({ where: { key: SETTING_KEY } });
  const stored = parseStored(row?.value);
  for (const job of stored) {
    if (jobs.has(job.id)) continue;
    if (job.phase === "error" && Date.now() - (job.errorAt ?? job.startedAt) > ERROR_TTL_MS) continue;
    jobs.set(job.id, job);
    if (job.phase === "error") continue;
    const user = await loadSessionUser(job.userId);
    if (!user) {
      job.phase = "error";
      job.error = "Restore-Benutzer nicht mehr vorhanden";
      job.errorAt = Date.now();
      continue;
    }
    void runRestoreJob(job.id, user);
  }
  await persistJobs();
}

async function runRestoreJob(id: string, user: SessionUser) {
  const job = jobs.get(id);
  if (!job) return;
  try {
    let upid = job.upid ?? "";
    if (!upid) {
      for (let attempt = job.attempt; attempt <= 50; attempt++) {
        job.attempt = attempt;
        await persistJobs();
        const result = await withHostClient(job.hostId, user, (client) =>
          restoreBackup(client, {
            hostId: job.hostId,
            node: job.node,
            volid: job.volid,
            vmid: job.vmid,
            storage: job.storage,
            force: job.force,
            startAfter: job.startAfter,
            forceStop: attempt >= 18,
          }),
        );
        if (result.upid) {
          upid = result.upid;
          job.upid = upid;
          job.phase = "running";
          await persistJobs();
          break;
        }
        if (result.phase !== "stopping") throw new Error("Wiederherstellung konnte nicht gestartet werden");
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
    }
    if (!upid) throw new Error("Gast läuft noch und konnte nicht heruntergefahren werden");
    job.upid = upid;
    job.phase = "running";
    await persistJobs();
    if (isUpid(upid)) {
      await withHostClient(job.hostId, user, (client) => waitUpid(client, job.node, upid, TASK_TIMEOUT.backup));
    }
    jobs.delete(id);
    try {
      await persistJobs();
    } catch (error) {
      logger.warn({ err: error }, "Restore job delete was not saved");
      jobs.set(id, job);
      return;
    }
    notifyTopic("backup.restored", {
      level: "success",
      title: "Backup eingespielt",
      message: `VM/CT ${job.vmid} ← ${job.volid} — fertig in ${durationLabel(Date.now() - job.startedAt)}`,
      hostId: job.hostId,
      name: job.name,
      id: String(job.vmid),
      host: job.hostName,
      node: job.node,
    });
  } catch (error) {
    const current = jobs.get(id);
    if (!current) return;
    current.phase = "error";
    current.error = error instanceof Error ? error.message : "Restore fehlgeschlagen";
    current.errorAt = Date.now();
    await persistJobs().catch(() => undefined);
    forgetRestoreJob(id);
    notifyTopic("backup.restored", {
      level: "error",
      title: "Restore fehlgeschlagen",
      message: `VM/CT ${current.vmid} — fehlgeschlagen: ${current.error}`,
      hostId: current.hostId,
      name: current.name,
      id: String(current.vmid),
      host: current.hostName,
      node: current.node,
    });
  }
}

function persistJobs(): Promise<void> {
  const run = persistChain.then(writeJobs);
  persistChain = run.catch((error) => {
    logger.warn({ err: error }, "Restore jobs persist failed");
  });
  return run;
}

function forgetRestoreJob(id: string) {
  setTimeout(() => {
    const job = jobs.get(id);
    if (!job || job.phase !== "error") return;
    jobs.delete(id);
    void persistJobs().catch(() => undefined);
  }, 60_000);
}

async function writeJobs() {
  const value = [...jobs.values()].map(storedJob) as unknown as Prisma.InputJsonValue;
  await prisma.setting.upsert({
    where: { key: SETTING_KEY },
    update: { value },
    create: { key: SETTING_KEY, value },
  });
}

function storedJob(job: RestoreJob): Omit<RestoreJob, never> {
  return {
    id: job.id,
    userId: job.userId,
    hostId: job.hostId,
    hostName: job.hostName,
    node: job.node,
    volid: job.volid,
    vmid: job.vmid,
    storage: job.storage,
    force: job.force,
    startAfter: job.startAfter,
    name: job.name,
    phase: job.phase,
    upid: job.upid,
    error: job.error,
    attempt: job.attempt,
    startedAt: job.startedAt,
    errorAt: job.errorAt,
  };
}

function parseStored(value: unknown): RestoreJob[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const job = row as Partial<RestoreJob>;
    if (!job.id || !job.userId || !job.hostId || !job.node || !job.volid || !job.storage) return [];
    if (job.phase !== "stopping" && job.phase !== "running" && job.phase !== "error") return [];
    if (typeof job.vmid !== "number") return [];
    return [
      {
        id: job.id,
        userId: job.userId,
        hostId: job.hostId,
        hostName: job.hostName ?? "",
        node: job.node,
        volid: job.volid,
        vmid: job.vmid,
        storage: job.storage,
        force: job.force,
        startAfter: job.startAfter,
        name: job.name,
        phase: job.phase,
        upid: job.upid,
        error: job.error,
        attempt: typeof job.attempt === "number" ? job.attempt : 1,
        startedAt: typeof job.startedAt === "number" ? job.startedAt : Date.now(),
        errorAt: typeof job.errorAt === "number" ? job.errorAt : undefined,
      },
    ];
  });
}

async function loadSessionUser(userId: string): Promise<SessionUser | null> {
  const record = await prisma.user.findUnique({
    where: { id: userId },
    include: { role: true, hostAccess: true, guestAccess: true },
  });
  if (!record || record.status !== "ACTIVE") return null;
  return toSessionUser(record);
}
