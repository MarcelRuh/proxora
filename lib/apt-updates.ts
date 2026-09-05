/** How often Proxora refreshes Proxmox APT package lists in the background. */
export const APT_REFRESH_INTERVAL_MS = 3 * 60 * 60 * 1000;
/** Wait after startup so host probes finish first. */
export const APT_REFRESH_STARTUP_DELAY_MS = 60_000;

export function shouldNotifyAptUpdates(previousNotifiedCount: number, currentCount: number): boolean {
  return currentCount > previousNotifiedCount;
}

export function aptSummaryFingerprint(
  hosts: Array<{ id: string; count: number }>,
): string {
  return hosts
    .filter((h) => h.count > 0)
    .map((h) => `${h.id}:${h.count}`)
    .sort()
    .join("|");
}

export function aptSummaryFromHosts(
  hosts: Array<{ id: string; name: string; aptUpdateCount?: number; aptCheckedAt?: Date | string | null }>,
) {
  const rows = hosts.map((h) => ({
    id: h.id,
    name: h.name,
    count: h.aptUpdateCount ?? 0,
    checkedAt: h.aptCheckedAt ?? null,
  }));
  const total = rows.reduce((sum, h) => sum + h.count, 0);
  const checkedAt = rows.reduce<Date | string | null>((latest, h) => {
    if (!h.checkedAt) return latest;
    if (!latest) return h.checkedAt;
    return new Date(h.checkedAt).getTime() > new Date(latest).getTime() ? h.checkedAt : latest;
  }, null);
  return { total, checkedAt, hosts: rows };
}

export function mergeHostUpdateDetails<
  T extends { host: { id: string; aptCheckedAt?: Date | string | null }; version: string | null; updates: unknown; error: string | null },
>(
  rows: T[] | undefined,
  hostId: string,
  next: { version: string | null; updates: T["updates"] },
  checkedAt: string,
): T[] | undefined {
  if (!rows) return rows;
  return rows.map((row) =>
    row.host.id === hostId
      ? { ...row, version: next.version, updates: next.updates, error: null, host: { ...row.host, aptCheckedAt: checkedAt } }
      : row,
  );
}
