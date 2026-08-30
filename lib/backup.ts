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

/** True when an existing guest must be stopped before a force-restore. */
export function guestNeedsStopForRestore(status: string | null | undefined): boolean {
  const s = String(status ?? "")
    .trim()
    .toLowerCase();
  return Boolean(s) && s !== "stopped";
}

export type ProxmoxLogLine = string | { t?: string; n?: number };

export function logLineText(line: ProxmoxLogLine): string {
  return (typeof line === "string" ? line : String(line.t ?? "")).replace(/\r$/, "");
}

/** Best-effort percent from Proxmox vzdump/qmrestore/vzrestore log lines. */
export function parseProxmoxTaskProgress(lines: ProxmoxLogLine[]): { percent: number | null; detail: string } {
  let percent: number | null = null;
  let detail = "";
  for (const line of lines) {
    const text = logLineText(line).trim();
    if (!text) continue;
    detail = text;
    const tagged = /\bprogress\s+(\d+(?:\.\d+)?)\s*%/i.exec(text);
    const percents = [...text.matchAll(/(\d{1,3}(?:\.\d+)?)\s*%/g)].map((m) => Number(m[1]));
    const raw = tagged?.[1] ?? (percents.length ? String(Math.max(...percents.filter((n) => Number.isFinite(n)))) : undefined);
    if (raw) {
      const n = Number(raw);
      if (Number.isFinite(n) && n >= 0 && n <= 100) percent = Math.max(percent ?? 0, n);
    }
    if (/extracting archive/i.test(text) && (percent == null || percent < 10)) {
      percent = Math.max(percent ?? 0, 10);
    }
    if (
      /\b(restore is finished|restore successful|backup is finished|backup finished)\b/i.test(text) ||
      /^TASK OK$/i.test(text)
    ) {
      percent = 100;
    }
  }
  return { percent, detail };
}

export async function waitUntilGuestStopped(
  readStatus: () => Promise<string | null | undefined>,
  options?: {
    timeoutMs?: number;
    intervalMs?: number;
    now?: () => number;
    sleepFn?: (ms: number) => Promise<void>;
  },
): Promise<boolean> {
  const timeoutMs = options?.timeoutMs ?? 90_000;
  const intervalMs = options?.intervalMs ?? 1_500;
  const now = options?.now ?? Date.now;
  const sleepFn = options?.sleepFn ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const started = now();
  for (;;) {
    const status = await readStatus();
    if (!guestNeedsStopForRestore(status)) return true;
    if (now() - started >= timeoutMs) return false;
    await sleepFn(intervalMs);
  }
}

export type BackupFileFilter = {
  query: string;
  kind: "all" | "vm" | "lxc";
  storage: string;
  period: "all" | "day" | "week" | "month";
  now?: number;
};

const PERIOD_MS: Record<Exclude<BackupFileFilter["period"], "all">, number> = {
  day: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
  month: 30 * 24 * 60 * 60 * 1000,
};

export function filterBackupFiles<T extends { volid: string; storage: string; vmid: number | null; kind: BackupKind; ctime: number }>(
  files: T[],
  filter: BackupFileFilter,
  names?: Map<number, string>,
): T[] {
  const q = filter.query.trim().toLowerCase();
  const minCtime = filter.period === "all" ? 0 : (filter.now ?? Date.now()) - PERIOD_MS[filter.period];
  return files.filter((file) => {
    if (filter.kind !== "all" && file.kind !== filter.kind) return false;
    if (filter.storage !== "all" && filter.storage && file.storage !== filter.storage) return false;
    if (minCtime > 0 && file.ctime > 0 && file.ctime < minCtime) return false;
    if (!q) return true;
    const name = file.vmid != null ? names?.get(file.vmid) ?? "" : "";
    return [String(file.vmid ?? ""), name, file.volid, file.storage].join(" ").toLowerCase().includes(q);
  });
}
