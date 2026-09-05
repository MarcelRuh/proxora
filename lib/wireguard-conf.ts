import { interfaceIpv4, isWireguardKey } from "@/lib/wireguard-keys";

/** Safe over typical internet/UDP paths (WG overhead on 1500 or PPPoE). */
export const WG_CLIENT_MTU = 1280;

export type WgConfPeer = {
  publicKey: string;
  endpoint?: string;
  allowedIPs: string;
  persistentKeepalive?: number;
  presharedKey?: string;
};

export type ParsedWgQuick = {
  privateKey: string;
  address: string;
  peers: WgConfPeer[];
};

/** Client config: one hub server, no ListenPort. DNS is never written (breaks Docker DNS). */
export function buildWg0Conf(input: {
  privateKey: string;
  address: string;
  peers: WgConfPeer[];
  mtu?: number;
}): string {
  const mtu = input.mtu && input.mtu >= 1280 && input.mtu <= 1420 ? input.mtu : WG_CLIENT_MTU;
  const lines = [
    "[Interface]",
    `PrivateKey = ${input.privateKey}`,
    `Address = ${input.address}`,
    `MTU = ${mtu}`,
    "",
  ];
  const seen = new Set<string>();
  for (const peer of input.peers) {
    const key = peer.publicKey.trim();
    if (!isWireguardKey(key) || seen.has(key)) continue;
    const allowed = peer.allowedIPs.trim();
    if (!allowed) continue;
    seen.add(key);
    lines.push("[Peer]");
    lines.push(`PublicKey = ${key}`);
    if (peer.presharedKey && isWireguardKey(peer.presharedKey)) {
      lines.push(`PresharedKey = ${peer.presharedKey.trim()}`);
    }
    if (peer.endpoint?.trim()) lines.push(`Endpoint = ${peer.endpoint.trim()}`);
    lines.push(`AllowedIPs = ${allowed}`);
    const ka = peer.persistentKeepalive ?? 25;
    if (ka > 0) lines.push(`PersistentKeepalive = ${ka}`);
    lines.push("");
  }
  return `${lines.join("\n").trim()}\n`;
}

function ipv4ToInt(ip: string): number | null {
  const o = ip.split(".").map((n) => Number.parseInt(n, 10));
  if (o.length !== 4 || o.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return ((o[0]! << 24) | (o[1]! << 16) | (o[2]! << 8) | o[3]!) >>> 0;
}

export function cidrContainsIpv4(cidr: string, ip: string): boolean {
  const trimmed = cidr.trim();
  if (!trimmed) return false;
  const slash = trimmed.indexOf("/");
  const net = (slash === -1 ? trimmed : trimmed.slice(0, slash)).trim();
  const prefix = slash === -1 ? 32 : Number.parseInt(trimmed.slice(slash + 1), 10);
  const netInt = ipv4ToInt(net);
  const ipInt = ipv4ToInt(ip.trim());
  if (netInt === null || ipInt === null || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) return false;
  if (prefix === 0) return true;
  const mask = prefix === 32 ? 0xffffffff : (~((1 << (32 - prefix)) - 1)) >>> 0;
  return (netInt & mask) === (ipInt & mask);
}

/** Adds ip/32 to AllowedIPs unless a listed CIDR already covers it. */
export function ensureIpInAllowedIps(allowedIPs: string, ip: string): string {
  const host = ip.trim().split("/")[0]?.trim() ?? "";
  if (!interfaceIpv4(host)) return allowedIPs.trim();
  const parts = allowedIPs
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.some((cidr) => cidrContainsIpv4(cidr, host))) return parts.join(", ");
  return [...parts, `${host}/32`].join(", ");
}

export function sanitizeClientAllowedIps(allowedIPs: string, address: string): string {
  const kept = allowedIPs
    .split(",")
    .map((s) => s.trim())
    .filter((part) => part && part !== "0.0.0.0/0" && part !== "::/0");
  if (kept.length) return kept.join(", ");
  const ip = interfaceIpv4(address.includes("/") ? address : `${address}/32`);
  const prefix = Number((address.split("/")[1] ?? "24").trim()) || 24;
  if (!ip) return "10.88.0.0/24";
  const o = ip.split(".").map((n) => Number.parseInt(n, 10));
  if (prefix >= 24) return `${o[0]}.${o[1]}.${o[2]}.0/${prefix}`;
  if (prefix >= 16) return `${o[0]}.${o[1]}.0.0/${prefix}`;
  return `${o[0]}.0.0.0/${prefix}`;
}

/** Stanza the WireGuard server admin adds for this Proxora. */
export function serverPeerSnippet(publicKey: string, address: string): string {
  const ip = interfaceIpv4(address.includes("/") ? address : `${address}/32`) ?? address.split("/")[0]?.trim();
  return `[Peer]\nPublicKey = ${publicKey}\nAllowedIPs = ${ip}/32\n`;
}

type ConfSection = { name: string; fields: Record<string, string[]> };

function parseIniSections(raw: string): ConfSection[] {
  const sections: ConfSection[] = [];
  let current: ConfSection | null = null;
  const text = raw.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith(";")) continue;
    const section = /^\[([^\]]+)]\s*$/.exec(trimmed);
    if (section) {
      current = { name: section[1].trim().toLowerCase(), fields: {} };
      sections.push(current);
      continue;
    }
    if (!current) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim().toLowerCase();
    const value = trimmed.slice(eq + 1).trim();
    (current.fields[key] ??= []).push(value);
  }
  return sections;
}

function firstIpv4Cidr(values: string[]): string | null {
  for (const value of values) {
    for (const part of value.split(",").map((s) => s.trim()).filter(Boolean)) {
      const host = part.split("/")[0]?.trim() ?? "";
      if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(host)) continue;
      return part.includes("/") ? part : `${host}/32`;
    }
  }
  return null;
}

function joinField(values: string[] | undefined): string {
  return (values ?? []).join(", ").trim();
}

export function parseWgQuickConf(raw: string): ParsedWgQuick {
  const sections = parseIniSections(raw);
  const iface = sections.find((s) => s.name === "interface");
  if (!iface) throw new Error("Missing [Interface]");
  const privateKey = joinField(iface.fields.privatekey);
  if (!isWireguardKey(privateKey)) throw new Error("Invalid PrivateKey");
  const address = firstIpv4Cidr(iface.fields.address ?? []);
  if (!address) throw new Error("Missing IPv4 Address");
  const peers: WgConfPeer[] = [];
  for (const section of sections.filter((s) => s.name === "peer")) {
    const publicKey = joinField(section.fields.publickey);
    if (!isWireguardKey(publicKey)) continue;
    const allowedIPs = joinField(section.fields.allowedips);
    if (!allowedIPs) continue;
    const endpoint = joinField(section.fields.endpoint);
    const keepaliveRaw = joinField(section.fields.persistentkeepalive);
    const keepalive = keepaliveRaw ? Number.parseInt(keepaliveRaw, 10) : undefined;
    const presharedKey = joinField(section.fields.presharedkey);
    peers.push({
      publicKey,
      endpoint: endpoint || undefined,
      allowedIPs,
      persistentKeepalive: Number.isInteger(keepalive) && keepalive! >= 0 ? keepalive : undefined,
      presharedKey: isWireguardKey(presharedKey) ? presharedKey : undefined,
    });
  }
  if (!peers.length) throw new Error("Missing [Peer]");
  return { privateKey, address, peers };
}
