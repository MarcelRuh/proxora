export type BackupKind = "vm" | "lxc" | "unknown";

export type ParsedBackupVolid = {
  storage: string;
  volume: string;
  filename: string;
  kind: BackupKind;
  vmid: number | null;
};

export function backupsForGuest<T extends { vmid: number | null; kind: BackupKind }>(
  files: T[],
  vmid: number,
  kind: "vm" | "lxc",
): T[] {
  return files.filter((file) => file.vmid === vmid && (file.kind === kind || file.kind === "unknown"));
}

export function backupsForGuestNewestFirst<T extends { vmid: number | null; kind: BackupKind; ctime: number }>(
  files: T[],
  vmid: number,
  kind: "vm" | "lxc",
): T[] {
  return backupsForGuest(files, vmid, kind).slice().sort((a, b) => b.ctime - a.ctime);
}

export function assertGuestBackupVolids(volids: string[], vmid: number, kind: "vm" | "lxc"): string[] {
  const unique = [...new Set(volids.map((value) => value.trim()).filter(Boolean))];
  for (const volid of unique) {
    const parsed = parseBackupVolid(volid);
    if (!parsed.storage || !parsed.volume) throw new Error(`Ungültiges Backup: ${volid}`);
    if (parsed.vmid != null && parsed.vmid !== vmid) {
      throw new Error(`Backup ${volid} gehört nicht zu ${kind} ${vmid}`);
    }
    if (parsed.kind !== "unknown" && parsed.kind !== kind) {
      throw new Error(`Backup ${volid} gehört nicht zu ${kind} ${vmid}`);
    }
  }
  return unique;
}

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

/** Proxmox weekday tokens, Monday-first like the PVE backup GUI. */
export const BACKUP_DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type BackupDay = (typeof BACKUP_DAYS)[number];

const BACKUP_DAY_SET = new Set<string>(BACKUP_DAYS);

function padClock(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function parseDayTokens(raw: string): BackupDay[] {
  const picked = new Set<BackupDay>();
  for (const part of raw.toLowerCase().split(/[,\s]+/).filter(Boolean)) {
    if (part.includes("..")) {
      const [from, to] = part.split("..");
      const start = BACKUP_DAYS.indexOf(from as BackupDay);
      const end = BACKUP_DAYS.indexOf(to as BackupDay);
      if (start >= 0 && end >= 0 && start <= end) {
        for (let i = start; i <= end; i++) picked.add(BACKUP_DAYS[i]);
      }
      continue;
    }
    if (BACKUP_DAY_SET.has(part)) picked.add(part as BackupDay);
  }
  return BACKUP_DAYS.filter((day) => picked.has(day));
}

export function parseBackupSchedule(raw: string): { time: string; days: BackupDay[] } {
  const trimmed = raw.trim().toLowerCase();
  const timeMatch = /(\d{1,2}):(\d{2})/.exec(trimmed);
  const hour = timeMatch ? Math.min(23, Number(timeMatch[1])) : 2;
  const minute = timeMatch ? Math.min(59, Number(timeMatch[2])) : 0;
  const time = padClock(Number.isFinite(hour) ? hour : 2, Number.isFinite(minute) ? minute : 0);
  const prefix = timeMatch ? trimmed.slice(0, timeMatch.index).trim() : trimmed;
  const days = parseDayTokens(prefix);
  return { time, days: days.length ? days : [...BACKUP_DAYS] };
}

export function formatBackupSchedule(days: readonly string[], time: string): string {
  const clock = parseBackupSchedule(time).time;
  const ordered = BACKUP_DAYS.filter((day) => days.includes(day));
  if (ordered.length === 0 || ordered.length === 7) return clock;
  return `${ordered.join(",")} ${clock}`;
}

/**
 * Current Proxmox only accepts `schedule` (calendar). `starttime`/`dow` and
 * `delete=starttime` are rejected (`unknown option 'starttime'`).
 */
export function jobSchedulePayload(schedule: string): Record<string, unknown> {
  const { time, days } = parseBackupSchedule(schedule);
  return { schedule: formatBackupSchedule(days, time) };
}

export function isBackupJobScheduleConflict(message: string): boolean {
  const m = message.toLowerCase();
  if (m.includes("starttime") && m.includes("schedule") && (m.includes("both") || m.includes("cannot"))) {
    return true;
  }
  return /delete:.*unknown option ['"]?starttime/.test(m);
}

/** vzdump requires `vmid` or `all=1`. job-id alone is not enough on every PVE version. */
export function vzdumpGuestParams(job: { all: boolean; vmid: string }): Record<string, unknown> {
  const vmid = job.vmid.replace(/\s+/g, "");
  if (job.all || !vmid) return { all: 1 };
  return { vmid };
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

/** Proxmox task logs are often empty at first (`204` / `no content`). */
export function isNoiseProxmoxLogLine(text: string): boolean {
  const t = text.trim();
  return !t || /^no content$/i.test(t);
}

export function isEmptyProxmoxTaskLogError(error: unknown): boolean {
  const status =
    typeof error === "object" && error && "status" in error ? Number((error as { status?: unknown }).status) : 0;
  if (status === 204 || status === 404) return true;
  const msg = error instanceof Error ? error.message : String(error ?? "");
  return /^\s*no content\s*$/i.test(msg);
}

export function normalizeProxmoxTaskLog(log: unknown): Array<{ n: number; t: string }> {
  if (typeof log === "string") {
    return isNoiseProxmoxLogLine(log) ? [] : [{ n: 1, t: log }];
  }
  if (!Array.isArray(log)) return [];
  const lines: Array<{ n: number; t: string }> = [];
  for (let i = 0; i < log.length; i++) {
    const raw = log[i];
    const text = logLineText(raw as ProxmoxLogLine);
    if (isNoiseProxmoxLogLine(text)) continue;
    const n = raw && typeof raw === "object" && "n" in raw ? Number(raw.n) : i + 1;
    lines.push({ n: Number.isFinite(n) && n > 0 ? n : i + 1, t: text });
  }
  return lines;
}

/** Best-effort percent from Proxmox vzdump/qmrestore/vzrestore log lines. */
export function parseProxmoxTaskProgress(lines: ProxmoxLogLine[]): { percent: number | null; detail: string } {
  let percent: number | null = null;
  let detail = "";
  for (const line of lines) {
    const text = logLineText(line).trim();
    if (isNoiseProxmoxLogLine(text)) continue;
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
