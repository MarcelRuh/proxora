export const MIN_VMID = 100;

/** Next free VMID below the highest used ID (all nodes). Falls back above max if 100..max are taken. */
export function nextSmallerVmid(
  used: Iterable<number>,
  min = MIN_VMID,
  skip?: (id: number) => boolean,
): number {
  const ids = [...new Set([...used].map((n) => Number(n)).filter((n) => Number.isInteger(n) && n >= min))];
  const taken = new Set(ids);
  const blocked = (id: number) => taken.has(id) || Boolean(skip?.(id));
  if (ids.length === 0) {
    let id = min;
    while (blocked(id)) id += 1;
    return id;
  }
  for (let id = Math.max(...ids) - 1; id >= min; id -= 1) {
    if (!blocked(id)) return id;
  }
  let up = Math.max(...ids) + 1;
  while (blocked(up)) up += 1;
  return up;
}
