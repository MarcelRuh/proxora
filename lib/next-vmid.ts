export const MIN_VMID = 100;

export function mergeUsedGuestSets(
  parts: Array<{ vmids?: Iterable<number>; ips?: Iterable<string> }>,
): { vmids: number[]; ips: string[] } {
  const vmids = new Set<number>();
  const ips = new Set<string>();
  for (const part of parts) {
    for (const id of part.vmids ?? []) {
      if (Number.isInteger(id) && id > 0) vmids.add(id);
    }
    for (const ip of part.ips ?? []) {
      if (ip) ips.add(ip);
    }
  }
  return { vmids: [...vmids], ips: [...ips] };
}

/**
 * Next free VMID above the highest used ID (all hosts in scope), like "max + 1".
 * `skip` blocks IDs that are free as VMID but unusable otherwise (e.g. implied IP taken).
 * Starts at `min` when nothing is used yet.
 */
export function nextVmidAboveHighest(
  used: Iterable<number>,
  min = MIN_VMID,
  skip?: (id: number) => boolean,
): number {
  const ids = [...new Set([...used].map((n) => Number(n)).filter((n) => Number.isInteger(n) && n >= min))];
  const taken = new Set(ids);
  const blocked = (id: number) => taken.has(id) || Boolean(skip?.(id));
  let id = ids.length > 0 ? Math.max(...ids) + 1 : min;
  while (blocked(id)) id += 1;
  return id;
}
