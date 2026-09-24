import { notifyTopic } from "@/server/notifications/dispatch";
import { TASK_TIMEOUT, isUpid, waitUpid } from "@/server/proxmox/task-wait";
import type { SessionUser } from "@/server/auth/session";
import { withHostClient } from "@/server/services/host-service";
import { restoreBackup } from "@/server/services/backup-service";
import { durationLabel } from "@/lib/duration";

export type RestoreJobView = {
  phase: "stopping" | "running" | "error";
  upid?: string;
  error?: string;
};

type RestoreJob = RestoreJobView & { id: string; hostId: string };

const jobs = new Map<string, RestoreJob>();

export function getRestoreJob(hostId: string, id: string): RestoreJobView | null {
  const job = jobs.get(id);
  if (!job || job.hostId !== hostId) return null;
  return { phase: job.phase, upid: job.upid, error: job.error };
}

export function enqueueRestoreJob(input: {
  user: SessionUser;
  hostId: string;
  hostName: string;
  node: string;
  volid: string;
  vmid: number;
  storage: string;
  force?: boolean;
  startAfter?: boolean;
  name?: string;
}): string {
  const id = `restore-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  jobs.set(id, { id, hostId: input.hostId, phase: "stopping" });
  void runRestoreJob(id, input);
  return id;
}

async function runRestoreJob(
  id: string,
  input: {
    user: SessionUser;
    hostId: string;
    hostName: string;
    node: string;
    volid: string;
    vmid: number;
    storage: string;
    force?: boolean;
    startAfter?: boolean;
    name?: string;
  },
) {
  const job = jobs.get(id);
  if (!job) return;
  const started = Date.now();
  try {
    let upid = "";
    for (let attempt = 1; attempt <= 50; attempt++) {
      const result = await withHostClient(input.hostId, input.user, (client) =>
        restoreBackup(client, {
          hostId: input.hostId,
          node: input.node,
          volid: input.volid,
          vmid: input.vmid,
          storage: input.storage,
          force: input.force,
          startAfter: input.startAfter,
          forceStop: attempt >= 18,
        }),
      );
      if (result.upid) {
        upid = result.upid;
        break;
      }
      if (result.phase !== "stopping") throw new Error("Wiederherstellung konnte nicht gestartet werden");
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    if (!upid) throw new Error("Gast läuft noch und konnte nicht heruntergefahren werden");
    job.upid = upid;
    job.phase = "running";
    if (isUpid(upid)) {
      await withHostClient(input.hostId, input.user, (client) =>
        waitUpid(client, input.node, upid, TASK_TIMEOUT.backup),
      );
    }
    notifyTopic("backup.restored", {
      level: "success",
      title: "Backup eingespielt",
      message: `VM/CT ${input.vmid} ← ${input.volid} — fertig in ${durationLabel(Date.now() - started)}`,
      hostId: input.hostId,
      name: input.name,
      id: String(input.vmid),
      host: input.hostName,
      node: input.node,
    });
  } catch (error) {
    job.phase = "error";
    job.error = error instanceof Error ? error.message : "Restore fehlgeschlagen";
    notifyTopic("backup.restored", {
      level: "error",
      title: "Restore fehlgeschlagen",
      message: `VM/CT ${input.vmid} — fehlgeschlagen: ${job.error}`,
      hostId: input.hostId,
      name: input.name,
      id: String(input.vmid),
      host: input.hostName,
      node: input.node,
    });
  }
}
