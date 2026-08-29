export const DISK_ALERT_PERCENT = 90;
export const DISK_CLEAR_PERCENT = 85;
export const DISK_ALERT_SETTING_KEY = "disk.alerts";
export const DISK_WATCH_STATE_KEY = "disk.watch.state";

export type DiskSample = {
  key: string;
  kind: "storage" | "guest";
  guestKind?: "vm" | "lxc";
  name: string;
  percent: number;
  hostId: string;
  hostName: string;
  node?: string;
  id?: string;
  href?: string;
};

export type DiskAlertSettings = {
  alertPercent: number;
  clearPercent: number;
};

export type DiskWatchState = {
  notified: Record<string, boolean>;
  samples: DiskSample[];
};

export type GuestFsEntry = {
  mountpoint?: string;
  type?: string;
  "total-bytes"?: number;
  "used-bytes"?: number;
  disk?: Array<{ "total-bytes"?: number; "used-bytes"?: number }>;
};

export function parseDiskAlertSettings(value: unknown): DiskAlertSettings {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const alertPercent = clampPercent(raw.alertPercent, DISK_ALERT_PERCENT);
  let clearPercent = clampPercent(raw.clearPercent, DISK_CLEAR_PERCENT);
  if (clearPercent >= alertPercent) clearPercent = Math.max(0, alertPercent - 5);
  return { alertPercent, clearPercent };
}

export function parseDiskWatchState(value: unknown): DiskWatchState {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const notified: Record<string, boolean> = {};
  if (raw.notified && typeof raw.notified === "object") {
    for (const [key, flag] of Object.entries(raw.notified as Record<string, unknown>)) {
      if (typeof flag === "boolean") notified[key] = flag;
    }
  }
  const samples = Array.isArray(raw.samples) ? raw.samples.filter(isDiskSample) : [];
  return { notified, samples };
}

function isDiskSample(value: unknown): value is DiskSample {
  if (!value || typeof value !== "object") return false;
  const row = value as DiskSample;
  return typeof row.key === "string" && (row.kind === "storage" || row.kind === "guest") && typeof row.percent === "number";
}

function clampPercent(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(99, Math.max(1, Math.round(n)));
}

export function diskUsagePercent(used: number | undefined | null, total: number | undefined | null): number | null {
  if (used == null || total == null) return null;
  if (!Number.isFinite(used) || !Number.isFinite(total) || total <= 0 || used < 0) return null;
  return Math.min(100, (used / total) * 100);
}

export function isStorageMonitored(storage: { enabled?: number; active?: number; total?: number }): boolean {
  if (storage.enabled === 0 || storage.active === 0) return false;
  if (storage.total == null || storage.total <= 0) return false;
  return true;
}

const SKIP_FS = /^(tmpfs|devtmpfs|devfs|overlay|squashfs|rpc_pipefs|nsfs|cgroup2?|proc|sysfs|fusectl|debugfs|tracefs|ramfs)$/i;
const SKIP_MOUNT = /^\/(proc|sys|dev|run|snap|boot\/efi)(\/|$)/;
/** Ignore EFI/config leftovers that sit at 100% while the guest disk still shows 0. */
export const MIN_GUEST_FS_BYTES = 512 * 1024 * 1024;

function fsUsage(entry: GuestFsEntry): { used: number; total: number } | null {
  const candidates = [
    { used: entry["used-bytes"], total: entry["total-bytes"] },
    ...(entry.disk ?? []).map((disk) => ({ used: disk["used-bytes"], total: disk["total-bytes"] })),
  ];
  for (const candidate of candidates) {
    if (diskUsagePercent(candidate.used, candidate.total) == null) continue;
    if ((candidate.total ?? 0) < MIN_GUEST_FS_BYTES) continue;
    return { used: candidate.used as number, total: candidate.total as number };
  }
  return null;
}

export function guestFilesystemPercent(entries: GuestFsEntry[] | undefined | null): number | null {
  if (!entries?.length) return null;
  const usable = entries.flatMap((entry) => {
    const mount = entry.mountpoint ?? "";
    const type = entry.type ?? "";
    if (!mount || mount === "none") return [];
    if (SKIP_FS.test(type) || SKIP_MOUNT.test(mount)) return [];
    const usage = fsUsage(entry);
    if (!usage) return [];
    return [{ mount, ...usage }];
  });
  if (!usable.length) return null;
  const root = usable.find((entry) => entry.mount === "/");
  if (root) return diskUsagePercent(root.used, root.total);
  const unixRoot = entries.some((entry) => entry.mountpoint === "/");
  if (unixRoot) return null;
  const biggest = usable.reduce((best, entry) => (entry.total > best.total ? entry : best));
  return diskUsagePercent(biggest.used, biggest.total);
}

/** Cluster disk=0 means "unknown", not empty — do not treat as 0% or 100%. */
export function guestClusterDiskPercent(used: number | undefined | null, total: number | undefined | null): number | null {
  if (used == null || used <= 0) return null;
  return diskUsagePercent(used, total);
}

/** Rising edge at alert%, reset below clear% so we do not spam while it hovers. */
export function applyDiskWatchState(
  notified: boolean,
  percent: number,
  alertAt = DISK_ALERT_PERCENT,
  clearAt = DISK_CLEAR_PERCENT,
): { notify: boolean; notified: boolean } {
  if (percent >= alertAt && !notified) return { notify: true, notified: true };
  if (percent < clearAt) return { notify: false, notified: false };
  return { notify: false, notified };
}

export function storageDiskKey(hostId: string, node: string, storage: string): string {
  return `storage:${hostId}:${node}:${storage}`;
}

export function guestDiskKey(hostId: string, kind: "vm" | "lxc", vmid: number): string {
  return `guest:${hostId}:${kind}:${vmid}`;
}

export function diskSampleHref(sample: Pick<DiskSample, "kind" | "guestKind" | "hostId" | "node" | "id">): string {
  if (sample.kind === "guest" && sample.hostId && sample.node && sample.id) {
    const base = sample.guestKind === "lxc" ? "containers" : "vms";
    return `/${base}/${sample.hostId}/${sample.node}/${sample.id}`;
  }
  return "/storage";
}
