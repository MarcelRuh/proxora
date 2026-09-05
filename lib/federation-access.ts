export type ShareLevel = "view" | "control" | "create";

const RANK: Record<ShareLevel, number> = { view: 1, control: 2, create: 3 };

export function shareRank(level: ShareLevel): number {
  return RANK[level];
}

export function shareAllows(granted: ShareLevel, needed: ShareLevel | "deny"): boolean {
  if (needed === "deny") return false;
  return RANK[granted] >= RANK[needed];
}

export function parseShareLevel(value: string | null | undefined): ShareLevel | null {
  const v = String(value ?? "").toLowerCase();
  if (v === "view" || v === "control" || v === "create") return v;
  return null;
}

/** Minimum share needed on the owning Proxora to proxy this Proxmox call. */
export function federationActionLevel(method: string, path: string): ShareLevel | "deny" {
  const m = method.toUpperCase();
  const p = path.split("?")[0] ?? "";
  const lower = p.toLowerCase();

  if (/\/nodes\/[^/]+\/status\/(reboot|shutdown|stopall)$/i.test(lower)) return "deny";
  if (lower.includes("/apt/") || /\/nodes\/[^/]+\/startall$/i.test(lower)) return "deny";
  if (/\/nodes\/[^/]+\/termproxy$/i.test(lower) && !/\/(qemu|lxc)\//i.test(lower)) return "deny";
  if (/\/nodes\/[^/]+\/vncshell$/i.test(lower) && !/\/(qemu|lxc)\//i.test(lower)) return "deny";

  if (m === "GET" || m === "HEAD") return "view";

  if (m === "POST" && /\/nodes\/[^/]+\/(qemu|lxc)$/i.test(lower)) return "create";
  if (m === "POST" && /\/clone$/i.test(lower)) return "create";

  return "control";
}
