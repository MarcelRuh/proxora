import { compactProxmoxBody } from "@/lib/lxc-net";
import {
  backupCtimeMs,
  guestNeedsStopForRestore,
  jobSchedulePayload,
  isBackupJobScheduleConflict,
  newBackupJobId,
  normalizeBackupJob,
  parseBackupVolid,
  pruneKeepLast,
  vzdumpGuestParams,
  waitUntilGuestStopped,
} from "@/lib/backup";
import { ValidationError } from "@/lib/errors";
import { TASK_TIMEOUT, waitUpid } from "@/server/proxmox/task-wait";
import { withHostClient } from "@/server/services/host-service";
import type { SessionUser } from "@/server/auth/session";
import { filterGuestsForUser } from "@/server/auth/session-core";
import type { ProxmoxClient } from "@/server/proxmox/client";
import { inventoryNodeNames, loadHostInventory } from "@/server/services/inventory-cache";
import { listStorageContentRows } from "@/server/services/storage-content";

export type BackupGuest = { vmid: number; name: string; kind: "vm" | "lxc"; node: string; status: string };

export type BackupFile = {
  volid: string;
  node: string;
  storage: string;
  vmid: number | null;
  kind: "vm" | "lxc" | "unknown";
  size: number;
  ctime: number;
  notes?: string;
  format?: string;
};

export async function listHostBackups(hostId: string, user: SessionUser) {
  return withHostClient(hostId, user, async (client) => {
    const [inv, jobsRaw] = await Promise.all([
      loadHostInventory(client, hostId),
      client.backup.jobs().catch(() => [] as Array<Record<string, unknown>>),
    ]);
    const vms = inv.vms;
    const containers = inv.containers;
    const nodeNames = inventoryNodeNames(inv);
    const fromInv = inv.storage.filter((s) => s.content);
    const storage = fromInv.length
      ? fromInv.map((s) => ({ storage: s.storage, content: s.content }))
      : await client.storage.list().catch(() => []);
    const primary = nodeNames[0] ?? "";
    const backupStorages = [...new Set(storage.filter((s) => (s.content ?? "").includes("backup")).map((s) => s.storage))];
    const diskStorages = [
      ...new Set(
        storage
          .filter((s) => {
            const content = s.content ?? "";
            return content.includes("images") || content.includes("rootdir");
          })
          .map((s) => s.storage),
      ),
    ];

    const guests: BackupGuest[] = [
      ...filterGuestsForUser(user, hostId, "vm", vms).map((g) => ({
        vmid: g.vmid,
        name: g.name,
        kind: "vm" as const,
        node: g.node,
        status: g.status,
      })),
      ...filterGuestsForUser(user, hostId, "lxc", containers).map((g) => ({
        vmid: g.vmid,
        name: g.name,
        kind: "lxc" as const,
        node: g.node,
        status: g.status,
      })),
    ].sort((a, b) => a.vmid - b.vmid);

    return {
      nodes: nodeNames,
      primaryNode: primary,
      backupStorages,
      diskStorages,
      jobs: (Array.isArray(jobsRaw) ? jobsRaw : []).map((job) => normalizeBackupJob(job)).filter((j) => j.id),
      files: [] as BackupFile[],
      guests,
    };
  });
}

export async function listHostBackupFiles(hostId: string, user: SessionUser) {
  return withHostClient(hostId, user, async (client) => {
    const inv = await loadHostInventory(client, hostId);
    const nodeNames = inventoryNodeNames(inv);
    const rows = await listStorageContentRows(client, nodeNames, "backup");
    const files: BackupFile[] = [];
    const seen = new Set<string>();
    for (const { node, storage, row } of rows) {
      const volid = String(row.volid ?? "");
      if (!volid || seen.has(volid)) continue;
      seen.add(volid);
      const parsed = parseBackupVolid(volid);
      files.push({
        volid,
        node,
        storage: parsed.storage || String(row.storage ?? storage),
        vmid: parsed.vmid ?? (Number(row.vmid) || null),
        kind: parsed.kind,
        size: Number(row.size ?? 0) || 0,
        ctime: backupCtimeMs(row.ctime),
        notes: row.notes ? String(row.notes) : undefined,
        format: row.format ? String(row.format) : undefined,
      });
    }
    files.sort((a, b) => b.ctime - a.ctime);
    const allowedVmids =
      user.allowedGuests === null
        ? null
        : new Set(user.allowedGuests.filter((g) => g.hostId === hostId).map((g) => g.vmid));
    return { files: allowedVmids ? files.filter((f) => f.vmid != null && allowedVmids.has(f.vmid)) : files };
  });
}

export function jobBody(input: {
  id?: string;
  enabled?: boolean;
  schedule: string;
  storage: string;
  mode?: string;
  compress?: string;
  all?: boolean;
  vmid?: string;
  node?: string;
  keepLast?: number | null;
}) {
  const vmid = String(input.vmid ?? "").replace(/\s+/g, "");
  const all = Boolean(input.all);
  if (!all && !vmid) {
    throw new ValidationError("Mindestens eine VM oder einen Container auswählen.");
  }
  return compactProxmoxBody({
    id: input.id,
    enabled: input.enabled === false ? 0 : 1,
    storage: input.storage,
    mode: input.mode ?? "snapshot",
    compress: input.compress ?? "zstd",
    all: all ? 1 : undefined,
    vmid: all ? undefined : vmid,
    node: input.node || undefined,
    "prune-backups": pruneKeepLast(input.keepLast),
    "notes-template": "{{guestname}}",
    ...jobSchedulePayload(input.schedule),
  });
}

export async function upsertBackupJob(
  client: ProxmoxClient,
  input: {
    id: string;
    update: boolean;
    enabled?: boolean;
    schedule: string;
    storage: string;
    mode?: string;
    compress?: string;
    all?: boolean;
    vmid?: string;
    node?: string;
    keepLast?: number | null;
  },
) {
  const payload = jobBody({ ...input, id: input.update ? undefined : input.id });
  if (!input.update) {
    await client.backup.createJob({ ...payload, id: input.id });
    return;
  }
  const jobs = await client.backup.jobs().catch(() => [] as Array<Record<string, unknown>>);
  const existing = (Array.isArray(jobs) ? jobs : []).find((row) => String(row.id) === input.id);
  const hasLegacyClock = Boolean(String(existing?.starttime ?? "").trim());
  if (hasLegacyClock) {
    await client.backup.deleteJob(input.id);
    await client.backup.createJob({ ...payload, id: input.id });
    return;
  }
  try {
    await client.backup.updateJob(input.id, payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!isBackupJobScheduleConflict(message)) throw error;
    await client.backup.deleteJob(input.id);
    await client.backup.createJob({ ...payload, id: input.id });
  }
}

export async function runBackupJob(client: ProxmoxClient, hostId: string, jobId: string, nodeHint?: string) {
  const jobs = await client.backup.jobs();
  const raw = (Array.isArray(jobs) ? jobs : []).find((j) => String(j.id) === jobId);
  if (!raw) throw new Error("Backup-Job nicht gefunden");
  const job = normalizeBackupJob(raw);
  const names = inventoryNodeNames(await loadHostInventory(client, hostId));
  const node = nodeHint || job.node || names[0];
  if (!node) throw new Error("Kein Node für das Backup");
  const upid = await client.backup.start(
    node,
    compactProxmoxBody({ "job-id": jobId, ...vzdumpGuestParams(job) }),
  );
  return { upid, job, node };
}

async function currentGuestStatus(
  client: ProxmoxClient,
  kind: "vm" | "lxc",
  node: string,
  vmid: number,
): Promise<string | null> {
  try {
    const rec = kind === "lxc" ? await client.lxc.status(node, vmid) : await client.vms.status(node, vmid);
    return String(rec.status ?? "");
  } catch {
    return null;
  }
}

async function stopGuestIfRunningForRestore(
  client: ProxmoxClient,
  input: { hostId: string; node: string; vmid: number; kind: "vm" | "lxc" },
) {
  const listed = await loadHostInventory(client, input.hostId).catch(() => ({ vms: [], containers: [] }));
  const ct = listed.containers.find((g) => g.vmid === input.vmid);
  const vm = listed.vms.find((g) => g.vmid === input.vmid);
  const match = input.kind === "lxc" ? ct ?? vm : vm ?? ct;
  const kind: "vm" | "lxc" = match ? (match === ct ? "lxc" : "vm") : input.kind;
  const node = match?.node || input.node;
  const status = match?.status ?? (await currentGuestStatus(client, kind, node, input.vmid));
  if (!guestNeedsStopForRestore(status)) return;

  const api = kind === "lxc" ? client.lxc : client.vms;
  try {
    await api.shutdown(node, input.vmid);
  } catch {
    // already stopping or not running
  }

  const stoppedGracefully = await waitUntilGuestStopped(() => currentGuestStatus(client, kind, node, input.vmid), {
    timeoutMs: 45_000,
  });
  if (!stoppedGracefully) {
    try {
      const upid = await api.stop(node, input.vmid);
      await waitUpid(client, node, upid, TASK_TIMEOUT.stop);
    } catch {
      // poll below
    }
  }

  const stopped = await waitUntilGuestStopped(() => currentGuestStatus(client, kind, node, input.vmid), {
    timeoutMs: 30_000,
  });
  if (!stopped) {
    throw new Error("Gast läuft noch und konnte nicht heruntergefahren werden");
  }
}

export async function restoreBackup(
  client: ProxmoxClient,
  input: { hostId: string; node: string; volid: string; vmid: number; storage: string; force?: boolean; startAfter?: boolean },
) {
  const parsed = parseBackupVolid(input.volid);
  const kind = parsed.kind === "unknown" ? "vm" : parsed.kind;
  if (input.force) {
    await stopGuestIfRunningForRestore(client, { hostId: input.hostId, node: input.node, vmid: input.vmid, kind });
  }
  const payload = compactProxmoxBody({
    vmid: input.vmid,
    storage: input.storage,
    force: input.force ? 1 : undefined,
    start: input.startAfter ? 1 : undefined,
  });
  if (kind === "lxc") {
    return client.backup.restoreLxc(input.node, {
      ...payload,
      ostemplate: input.volid,
      restore: 1,
    });
  }
  return client.backup.restoreVm(input.node, {
    ...payload,
    archive: input.volid,
  });
}
