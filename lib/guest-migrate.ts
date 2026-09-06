export function migrateTargetNodes(
  nodes: Array<{ node: string; online?: string }>,
  current: string,
): string[] {
  const here = current.trim();
  return nodes
    .filter((n) => n.node && n.node !== here && n.online !== "offline" && n.online !== "unknown")
    .map((n) => n.node);
}

/** PVE migrate only works to another online node in the same cluster. */
export function hostAllowsMigrate(
  isClusterMember: boolean | null | undefined,
  nodes: Array<{ node: string; online?: string }> | undefined,
  currentNode: string,
): boolean {
  if (!isClusterMember) return false;
  return migrateTargetNodes(nodes ?? [], currentNode).length > 0;
}

export function migrateTargetAllowed(
  nodes: Array<{ node: string; online?: string }>,
  currentNode: string,
  target: string,
): boolean {
  const dest = target.trim();
  if (!dest || dest === currentNode.trim()) return false;
  return migrateTargetNodes(nodes, currentNode).includes(dest);
}

export function inventoryNodesForMigrate(
  nodes: Array<{ node?: unknown; status?: unknown }>,
): Array<{ node: string; online: string }> {
  return nodes
    .map((n) => ({ node: String(n.node ?? "").trim(), online: String(n.status ?? "online") }))
    .filter((n) => n.node);
}

export function qemuMigrateParams(target: string, running: boolean): Record<string, unknown> {
  return {
    target,
    online: running ? 1 : 0,
    "with-local-disks": 1,
  };
}

export function lxcMigrateParams(target: string, running: boolean): Record<string, unknown> {
  return {
    target,
    restart: running ? 1 : 0,
  };
}

export function guestIsRunning(status: string | undefined): boolean {
  return status === "running" || status === "paused";
}
