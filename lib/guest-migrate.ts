export function migrateTargetNodes(
  nodes: Array<{ node: string; online?: string }>,
  current: string,
): string[] {
  const here = current.trim();
  return nodes
    .filter((n) => n.node && n.node !== here && n.online !== "offline" && n.online !== "unknown")
    .map((n) => n.node);
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
