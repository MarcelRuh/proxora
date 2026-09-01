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
