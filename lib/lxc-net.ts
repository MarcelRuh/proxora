export type LxcIpMode = "dhcp" | "static";

export function normalizeLxcCidr(value: string): string {
  const ip = value.trim();
  if (!ip) return "";
  return ip.includes("/") ? ip : `${ip}/24`;
}

export function buildLxcNet0(input: {
  bridge: string;
  vlan?: number;
  mode: LxcIpMode;
  cidr?: string;
  gateway?: string;
}): string {
  const parts = ["name=eth0", `bridge=${input.bridge}`];
  if (input.vlan) parts.push(`tag=${input.vlan}`);
  if (input.mode === "dhcp") {
    parts.push("ip=dhcp");
  } else {
    const cidr = normalizeLxcCidr(input.cidr ?? "");
    parts.push(`ip=${cidr}`);
    const gw = input.gateway?.trim();
    if (gw) parts.push(`gw=${gw}`);
  }
  return parts.join(",");
}

export function compactProxmoxBody(body: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(body).filter(([, value]) => value !== undefined && value !== null && value !== ""),
  );
}
