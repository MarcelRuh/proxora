export function identityConflict(
  used: { vmids: Iterable<number>; ips?: Iterable<string> },
  vmid: number,
  ip?: string | null,
): "vmid" | "ip" | null {
  const vmids = new Set([...used.vmids].map((n) => Number(n)));
  if (vmids.has(vmid)) return "vmid";
  if (ip) {
    const ips = new Set([...(used.ips ?? [])]);
    if (ips.has(ip)) return "ip";
  }
  return null;
}

export type IdentityHost = { id: string; origin: "LOCAL" | "PEER" };

/** Local create: all local hosts. Colleague create: only that cluster. */
export function hostsInGuestIdentityScope(target: IdentityHost, all: IdentityHost[]): IdentityHost[] {
  if (target.origin === "PEER") return all.filter((h) => h.id === target.id);
  return all.filter((h) => h.origin === "LOCAL");
}
