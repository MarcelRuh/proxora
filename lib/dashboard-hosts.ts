export type DashboardHostOrigin = {
  origin?: "LOCAL" | "PEER";
  peerName?: string | null;
};

export function ownDashboardHosts<T extends DashboardHostOrigin>(hosts: T[]): T[] {
  return hosts.filter((host) => host.origin !== "PEER");
}

export function sharedDashboardHosts<T extends DashboardHostOrigin>(hosts: T[]): T[] {
  return hosts.filter((host) => host.origin === "PEER");
}

export function groupSharedDashboardHosts<T extends DashboardHostOrigin>(hosts: T[], fallback: string): Array<[string, T[]]> {
  const groups = new Map<string, T[]>();
  for (const host of hosts) {
    const key = host.peerName?.trim() || fallback;
    const bucket = groups.get(key) ?? [];
    bucket.push(host);
    groups.set(key, bucket);
  }
  return [...groups.entries()];
}
