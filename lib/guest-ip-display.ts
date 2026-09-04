export function uniqueGuestIps(ips: string[] | undefined | null): string[] {
  if (!ips?.length) return [];
  return [...new Set(ips.map((ip) => ip.trim()).filter(Boolean))];
}

export function formatGuestIps(ips: string[] | undefined | null): string {
  const list = uniqueGuestIps(ips);
  if (!list.length) return "";
  if (list.length === 1) return list[0]!;
  return `${list[0]} +${list.length - 1}`;
}
