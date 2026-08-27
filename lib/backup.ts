export type BackupKind = "vm" | "lxc" | "unknown";

export type ParsedBackupVolid = {
  storage: string;
  volume: string;
  filename: string;
  kind: BackupKind;
  vmid: number | null;
};

export function parseBackupVolid(volid: string): ParsedBackupVolid {
  const raw = volid.trim();
  const colon = raw.indexOf(":");
  const storage = colon >= 0 ? raw.slice(0, colon) : "";
  const volume = colon >= 0 ? raw.slice(colon + 1) : raw;
  const filename = volume.split("/").pop() ?? volume;

  const qemuFile = /vzdump-qemu-(\d+)/i.exec(filename);
  const lxcFile = /vzdump-lxc-(\d+)/i.exec(filename);
  const pbsVm = /(?:^|\/)vm\/(\d+)(?:\/|$)/.exec(volume);
  const pbsCt = /(?:^|\/)ct\/(\d+)(?:\/|$)/.exec(volume);

  if (qemuFile) return { storage, volume, filename, kind: "vm", vmid: Number(qemuFile[1]) };
  if (lxcFile) return { storage, volume, filename, kind: "lxc", vmid: Number(lxcFile[1]) };
  if (pbsVm) return { storage, volume, filename, kind: "vm", vmid: Number(pbsVm[1]) };
  if (pbsCt) return { storage, volume, filename, kind: "lxc", vmid: Number(pbsCt[1]) };
  return { storage, volume, filename, kind: "unknown", vmid: null };
}

export function backupCtimeMs(ctime: unknown): number {
  const n = Number(ctime);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n > 1e12 ? n : n * 1000;
}

export function pruneKeepLast(keepLast?: number | null): string | undefined {
  if (!keepLast || keepLast < 1) return undefined;
  return `keep-last=${keepLast}`;
}

export function parseKeepLast(prune: unknown): number | null {
  const raw = String(prune ?? "");
  const match = /keep-last=(\d+)/.exec(raw);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) ? n : null;
}

export function jobSchedulePayload(schedule: string): Record<string, unknown> {
  const trimmed = schedule.trim();
  if (/^\d{1,2}:\d{2}$/.test(trimmed)) {
    return { schedule: trimmed, starttime: trimmed };
  }
  return { schedule: trimmed };
}

export function normalizeBackupJob(raw: Record<string, unknown>): {
  id: string;
  enabled: boolean;
  schedule: string;
  storage: string;
  mode: string;
  compress: string;
  all: boolean;
  vmid: string;
  node: string;
  prune: string;
  keepLast: number | null;
} {
  const starttime = String(raw.starttime ?? "").trim();
  const dow = String(raw.dow ?? "").trim();
  const schedule =
    String(raw.schedule ?? "").trim() || [dow, starttime].filter(Boolean).join(" ").trim() || starttime;
  const prune = String(raw["prune-backups"] ?? raw.prune_backups ?? "").trim();
  return {
    id: String(raw.id ?? ""),
    enabled: raw.enabled === 1 || raw.enabled === "1" || raw.enabled === true,
    schedule,
    storage: String(raw.storage ?? ""),
    mode: String(raw.mode ?? "snapshot"),
    compress: String(raw.compress ?? "zstd"),
    all: raw.all === 1 || raw.all === "1" || raw.all === true,
    vmid: String(raw.vmid ?? "").trim(),
    node: String(raw.node ?? "").trim(),
    prune,
    keepLast: parseKeepLast(prune),
  };
}

export function newBackupJobId(): string {
  return `backup-${Date.now().toString(36)}`;
}
