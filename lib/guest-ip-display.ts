export function uniqueGuestIps(ips: string[] | undefined | null): string[] {
  if (!ips?.length) return [];
  return [...new Set(ips.map((ip) => ip.trim()).filter(Boolean))];
}

export function formatGuestIps(ips: string[] | undefined | null): string {
  return uniqueGuestIps(ips).join(", ");
}
