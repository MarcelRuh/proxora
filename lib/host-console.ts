/** Prefer an explicitly requested node, then an online node, then the first listed. */
export function pickHostConsoleNode(
  nodes: Array<{ node: string; online?: string }>,
  requested?: string | null,
): string | null {
  const names = nodes.map((n) => n.node).filter(Boolean);
  if (!names.length) return null;
  if (requested && names.includes(requested)) return requested;
  const online = nodes.find((n) => n.online === "online" && n.node);
  return online?.node ?? names[0] ?? null;
}

export function isHostConsolePermissionError(message: string): boolean {
  return /permission|forbidden|sys\.console|\b403\b/i.test(message);
}

export function consoleProxyErrorDetail(
  kind: "vm" | "lxc" | "node",
  parsed: { code?: string; message?: string },
): { key: "guest.consoleSerialMissing" | "hosts.terminalPermission" } | { message: string } {
  if (parsed.code === "no-serial") return { key: "guest.consoleSerialMissing" };
  const message = (parsed.message ?? "").trim();
  if (kind === "node" && isHostConsolePermissionError(message)) {
    return { key: "hosts.terminalPermission" };
  }
  return { message };
}
