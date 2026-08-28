import { compactProxmoxBody } from "@/lib/lxc-net";
import {
  backupCtimeMs,
  guestNeedsStopForRestore,
  jobSchedulePayload,
  newBackupJobId,
  normalizeBackupJob,
  parseBackupVolid,
  pruneKeepLast,
  waitUntilGuestStopped,
} from "@/lib/backup";
import { TASK_TIMEOUT, waitUpid } from "@/server/proxmox/task-wait";
import { withHostClient } from "@/server/services/host-service";
import type { SessionUser } from "@/server/auth/session";
import { filterGuestsForUser } from "@/server/auth/session-core";
import type { ProxmoxClient } from "@/server/proxmox/client";

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
    const [nodes, listed, jobsRaw] = await Promise.all([
      client.nodes.list(),
      client.listGuests().catch(() => ({ vms: [], containers: [] })),
      client.backup.jobs().catch(() => [] as Array<Record<string, unknown>>),
    ]);
    const vms = listed.vms;
    const containers = listed.containers;
    const nodeNames = nodes.map((n) => n.node);
    const primary = nodeNames[0] ?? "";
    const storageLists = await Promise.all(
      nodeNames.map(async (node) => ({
        node,
        storage: await client.storage.list(node).catch(() => []),
      })),
    );
    const backupStorages = [
      ...new Set(
        storageLists.flatMap((row) =>
          row.storage.filter((s) => (s.content ?? "").includes("backup")).map((s) => s.storage),
        ),
      ),
    ];
    const diskStorages = [
      ...new Set(
        storageLists.flatMap((row) =>
          row.storage
            .filter((s) => {
              const content = s.content ?? "";
              return content.includes("images") || content.includes("rootdir");
            })
            .map((s) => s.storage),
        ),
      ),
    ];

    const files: BackupFile[] = [];
    const seen = new Set<string>();
    for (const row of storageLists) {
      const backupStores = row.storage.filter((s) => (s.content ?? "").includes("backup"));
      const contents = await Promise.all(
        backupStores.map((s) => client.storage.content(row.node, s.storage, "backup").catch(() => [])),
      );
      for (const item of contents.flat()) {
        const volid = String(item.volid ?? "");
        if (!volid || seen.has(volid)) continue;
        seen.add(volid);
        const parsed = parseBackupVolid(volid);
        files.push({
          volid,
          node: row.node,
          storage: parsed.storage || String(item.storage ?? ""),
          vmid: parsed.vmid ?? (Number(item.vmid) || null),
          kind: parsed.kind,
          size: Number(item.size ?? 0) || 0,
          ctime: backupCtimeMs(item.ctime),
          notes: item.notes ? String(item.notes) : undefined,
          format: item.format ? String(item.format) : undefined,
        });
      }
    }
    files.sort((a, b) => b.ctime - a.ctime);

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
    const allowedVmids =
      user.allowedGuests === null
        ? null
        : new Set(user.allowedGuests.filter((g) => g.hostId === hostId).map((g) => g.vmid));

    return {
      nodes: nodeNames,
      primaryNode: primary,
      backupStorages,
      diskStorages,
      jobs: (Array.isArray(jobsRaw) ? jobsRaw : []).map((job) => normalizeBackupJob(job)).filter((j) => j.id),
      files: allowedVmids ? files.filter((f) => f.vmid != null && allowedVmids.has(f.vmid)) : files,
      guests,
    };
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
  const all = Boolean(input.all) || !String(input.vmid ?? "").trim();
  return compactProxmoxBody({
    id: input.id,
    enabled: input.enabled === false ? 0 : 1,
    storage: input.storage,
    mode: input.mode ?? "snapshot",
    compress: input.compress ?? "zstd",
    all: all ? 1 : 0,
    vmid: all ? undefined : String(input.vmid).replace(/\s+/g, ""),
    node: input.node || undefined,
    "prune-backups": pruneKeepLast(input.keepLast),
    "notes-template": "{{guestname}}",
    ...jobSchedulePayload(input.schedule),
  });
}

export async function runBackupJob(client: ProxmoxClient, jobId: string, nodeHint?: string) {
  const jobs = await client.backup.jobs();
  const raw = (Array.isArray(jobs) ? jobs : []).find((j) => String(j.id) === jobId);
  if (!raw) throw new Error("Backup-Job nicht gefunden");
  const job = normalizeBackupJob(raw);
  const nodes = await client.nodes.list();
  const node = nodeHint || job.node || nodes[0]?.node;
  if (!node) throw new Error("Kein Node für das Backup");
  const upid = await client.backup.start(node, compactProxmoxBody({ "job-id": jobId, vmid: job.all ? undefined : job.vmid }));
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
  input: { node: string; vmid: number; kind: "vm" | "lxc" },
) {
  const listed = await client.listGuests().catch(() => ({ vms: [], containers: [] }));
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
  input: { node: string; volid: string; vmid: number; storage: string; force?: boolean; startAfter?: boolean },
) {
  const parsed = parseBackupVolid(input.volid);
  const kind = parsed.kind === "unknown" ? "vm" : parsed.kind;
  if (input.force) {
    await stopGuestIfRunningForRestore(client, { node: input.node, vmid: input.vmid, kind });
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
