export const ZFS_WATCH_STATE_KEY = "zfs.watch.state";

export type ZfsWatchState = {
  notified: Record<string, boolean>;
};

export function parseZfsWatchState(value: unknown): ZfsWatchState {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const notified: Record<string, boolean> = {};
  if (raw.notified && typeof raw.notified === "object") {
    for (const [key, flag] of Object.entries(raw.notified as Record<string, unknown>)) {
      if (typeof flag === "boolean") notified[key] = flag;
    }
  }
  return { notified };
}

export function applyZfsWatchState(notified: boolean, healthy: boolean): { notify: boolean; notified: boolean } {
  if (!healthy && !notified) return { notify: true, notified: true };
  if (healthy) return { notify: false, notified: false };
  return { notify: false, notified };
}

export function zfsPoolKey(hostId: string, node: string, pool: string): string {
  return `zfs:${hostId}:${node}:${pool}`;
}
