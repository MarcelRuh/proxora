export const DISK_ALERT_PERCENT = 90;
export const DISK_CLEAR_PERCENT = 85;

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
};

export function diskUsagePercent(used: number | undefined | null, total: number | undefined | null): number | null {
  if (used == null || total == null) return null;
  if (!Number.isFinite(used) || !Number.isFinite(total) || total <= 0 || used < 0) return null;
  return Math.min(100, (used / total) * 100);
}

/** Rising edge at 90%, reset below 85% so we do not spam while it hovers. */
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
