export const MIN_VMID = 100;

/** Next free VMID below the highest used ID (all nodes). Falls back above max if 100..max are taken. */
export function nextSmallerVmid(used: Iterable<number>, min = MIN_VMID): number {
  const ids = [...new Set([...used].map((n) => Number(n)).filter((n) => Number.isInteger(n) && n >= min))];
  if (ids.length === 0) return min;
  const taken = new Set(ids);
  for (let id = Math.max(...ids) - 1; id >= min; id -= 1) {
    if (!taken.has(id)) return id;
  }
  let up = Math.max(...ids) + 1;
  while (taken.has(up)) up += 1;
  return up;
}
