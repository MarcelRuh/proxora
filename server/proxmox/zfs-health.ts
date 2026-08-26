export type ZfsDiskState = "ONLINE" | "DEGRADED" | "FAULTED" | "OFFLINE" | "UNAVAIL" | "REMOVED" | "UNKNOWN";

export type ZfsDiskStatus = {
  name: string;
  role: string;
  state: ZfsDiskState;
  read: number;
  write: number;
  cksum: number;
  healthy: boolean;
};

export type ZfsPoolHealth = {
  allHealthy: boolean;
  healthyDisks: number;
  totalDisks: number;
  problemDisks: number;
  devices: ZfsDiskStatus[];
};

const PROBLEM_STATES = new Set(["DEGRADED", "FAULTED", "OFFLINE", "UNAVAIL", "REMOVED"]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function num(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function normalizeZfsState(value: unknown): ZfsDiskState {
  const raw = String(value ?? "UNKNOWN").toUpperCase();
  if (raw === "ONLINE" || raw === "DEGRADED" || raw === "FAULTED" || raw === "OFFLINE" || raw === "UNAVAIL" || raw === "REMOVED") {
    return raw;
  }
  return "UNKNOWN";
}

function isVdevGroup(name: string): boolean {
  return /^(mirror|raidz\d*|draid\d*|spare|log|cache|special|dedup)(-|$)/i.test(name);
}

function walk(node: unknown, parentRole: string, out: ZfsDiskStatus[]): void {
  const rec = asRecord(node);
  if (!rec) return;
  const name = String(rec.name ?? rec.device ?? rec.dev ?? "").trim() || "unknown";
  const children = Array.isArray(rec.children) ? rec.children : [];
  const role = isVdevGroup(name) ? name : parentRole;
  if (children.length > 0) {
    for (const child of children) walk(child, role, out);
    return;
  }
  const state = normalizeZfsState(rec.state ?? rec.health ?? rec.status);
  const read = num(rec.read);
  const write = num(rec.write);
  const cksum = num(rec.cksum);
  const healthy = state === "ONLINE" && read === 0 && write === 0 && cksum === 0;
  out.push({ name, role, state, read, write, cksum, healthy });
}

export function summarizeZfsPool(detail: unknown, poolHealth?: string): ZfsPoolHealth {
  const rec = asRecord(detail);
  const devices: ZfsDiskStatus[] = [];
  if (rec) {
    const children = Array.isArray(rec.children) ? rec.children : Array.isArray(rec.devices) ? rec.devices : [];
    if (children.length > 0) {
      for (const child of children) walk(child, "pool", devices);
    }
  }
  const poolState = normalizeZfsState(poolHealth ?? rec?.health ?? rec?.state);
  const totalDisks = devices.length;
  const problemDisks = devices.filter((d) => !d.healthy || PROBLEM_STATES.has(d.state)).length;
  const healthyDisks = devices.filter((d) => d.healthy).length;
  const allHealthy = (totalDisks === 0 ? poolState === "ONLINE" : problemDisks === 0) && poolState === "ONLINE";
  return { allHealthy, healthyDisks, totalDisks, problemDisks, devices };
}
