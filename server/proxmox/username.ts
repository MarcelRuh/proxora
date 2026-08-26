export function normalizeProxmoxUsername(username: string): string {
  const trimmed = username.trim();
  if (!trimmed) return trimmed;
  return trimmed.includes("@") ? trimmed : `${trimmed}@pam`;
}
