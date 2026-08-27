export type CpuSample = { cpu?: number; maxcpu?: number };

export function weightedCpuRatio(nodes: CpuSample[]): number | undefined {
  let used = 0;
  let cores = 0;
  for (const n of nodes) {
    const c = n.maxcpu ?? 0;
    if (c > 0 && n.cpu != null && Number.isFinite(n.cpu)) {
      used += n.cpu * c;
      cores += c;
    }
  }
  if (cores > 0) return used / cores;
  const samples = nodes.map((n) => n.cpu).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (!samples.length) return undefined;
  return samples.reduce((acc, v) => acc + v, 0) / samples.length;
}

export function minPositiveUptime(nodes: Array<{ uptime?: number }>): number | undefined {
  const ups = nodes.map((n) => n.uptime).filter((v): v is number => typeof v === "number" && v > 0);
  if (!ups.length) return undefined;
  return Math.min(...ups);
}

export function uniqueNonEmpty(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((v): v is string => Boolean(v && v.trim())))];
}

export function isClusterNodeOnline(status: string | undefined): boolean {
  if (status === "offline" || status === "unknown") return false;
  return status === "online" || status === undefined;
}
