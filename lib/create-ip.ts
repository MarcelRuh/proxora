export type GuestIpNetwork = {
  id: string;
  prefix: number;
  gateway: string;
};

export type GuestIpSettings = {
  defaults: GuestIpNetwork[];
  byHost: Record<string, GuestIpNetwork[]>;
};

export const GUEST_IP_SETTING_KEY = "guest-ip";

export const GUEST_IP_NETWORKS: GuestIpNetwork[] = [
  { id: "192.168.178.0", prefix: 24, gateway: "192.168.178.1" },
  { id: "192.168.1.0", prefix: 24, gateway: "192.168.1.1" },
  { id: "192.168.2.0", prefix: 24, gateway: "192.168.2.1" },
];

export const DEFAULT_GUEST_NETWORK = "192.168.178.0";

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

export function isIpv4(value: string): boolean {
  const m = IPV4.exec(value.trim());
  if (!m) return false;
  return m.slice(1).every((part) => {
    const n = Number(part);
    return n >= 0 && n <= 255;
  });
}

export function ipv4Host(cidr: string): string | null {
  const host = cidr.trim().split("/")[0]?.trim() ?? "";
  return isIpv4(host) ? host : null;
}

export function parseGuestIpNetworks(value: unknown): GuestIpNetwork[] {
  if (!Array.isArray(value)) return [];
  const out: GuestIpNetwork[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const id = String(rec.id ?? "").trim();
    const prefix = Number(rec.prefix ?? 24);
    const gateway = String(rec.gateway ?? "").trim();
    if (!isIpv4(id) || !isIpv4(gateway)) continue;
    if (!Number.isInteger(prefix) || prefix < 8 || prefix > 32) continue;
    out.push({ id, prefix, gateway });
  }
  return out;
}

export function parseGuestIpSettings(value: unknown): GuestIpSettings {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const listed = parseGuestIpNetworks(raw.defaults ?? (Array.isArray(value) ? value : undefined));
  const defaults = listed.length ? listed : GUEST_IP_NETWORKS.map((n) => ({ ...n }));
  const byHost: Record<string, GuestIpNetwork[]> = {};
  if (raw.byHost && typeof raw.byHost === "object") {
    for (const [hostId, list] of Object.entries(raw.byHost as Record<string, unknown>)) {
      const nets = parseGuestIpNetworks(list);
      if (nets.length) byHost[hostId] = nets;
    }
  }
  return { defaults, byHost };
}

export function networksForHost(settings: GuestIpSettings, hostId: string): GuestIpNetwork[] {
  return settings.byHost[hostId]?.length ? settings.byHost[hostId]! : settings.defaults;
}

export function guestIpNetwork(id: string, networks: GuestIpNetwork[] = GUEST_IP_NETWORKS): GuestIpNetwork {
  return networks.find((n) => n.id === id) ?? networks[0] ?? GUEST_IP_NETWORKS[0]!;
}

/** Last octet follows the VMID: 242 → 192.168.178.242. IDs outside 1–254 cannot map. */
export function guestIpFromVmid(networkId: string, vmid: number, networks?: GuestIpNetwork[]): string | null {
  if (!Number.isInteger(vmid) || vmid < 1 || vmid > 254) return null;
  const net = guestIpNetwork(networkId, networks);
  const [a, b, c] = net.id.split(".");
  if (!a || !b || !c) return null;
  return `${a}.${b}.${c}.${vmid}`;
}

export function guestCidrFromVmid(networkId: string, vmid: number, networks?: GuestIpNetwork[]): string {
  const ip = guestIpFromVmid(networkId, vmid, networks);
  return ip ? `${ip}/${guestIpNetwork(networkId, networks).prefix}` : "";
}

export function guestGateway(networkId: string, networks?: GuestIpNetwork[]): string {
  return guestIpNetwork(networkId, networks).gateway;
}

/** True when empty or still the auto IP for this network + VMID. */
export function shouldSyncGuestIp(
  cidr: string,
  networkId: string,
  vmid: number,
  networks?: GuestIpNetwork[],
): boolean {
  if (!cidr.trim()) return true;
  const host = ipv4Host(cidr);
  if (!host) return false;
  const suggestedHost = guestIpFromVmid(networkId, vmid, networks);
  return Boolean(suggestedHost && host === suggestedHost);
}

export function parseGuestConfigIps(config: Record<string, unknown>): string[] {
  const ips: string[] = [];
  for (const [key, value] of Object.entries(config)) {
    if (typeof value !== "string") continue;
    if (!/^(net|ipconfig)\d+$/i.test(key)) continue;
    const match = value.match(/(?:^|,)ip=([^,]*)/i);
    const raw = match?.[1]?.trim() ?? "";
    if (!raw || raw.toLowerCase() === "dhcp" || raw.toLowerCase() === "manual") continue;
    const host = ipv4Host(raw);
    if (host) ips.push(host);
  }
  return ips;
}

/** QEMU guest-agent `network-get-interfaces` (skips loopback and IPv6). */
export function parseAgentNetworkIps(payload: unknown): string[] {
  const root = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const list = Array.isArray(payload) ? payload : Array.isArray(root.result) ? root.result : [];
  const ips: string[] = [];
  for (const nic of list) {
    if (!nic || typeof nic !== "object") continue;
    const rec = nic as Record<string, unknown>;
    const name = String(rec.name ?? "").trim().toLowerCase();
    if (!name || name === "lo" || name.startsWith("lo:")) continue;
    const addrs = rec["ip-addresses"] ?? rec.ip_addresses;
    if (!Array.isArray(addrs)) continue;
    for (const entry of addrs) {
      if (!entry || typeof entry !== "object") continue;
      const addr = entry as Record<string, unknown>;
      const type = String(addr["ip-address-type"] ?? addr.type ?? "").toLowerCase();
      if (type === "ipv6") continue;
      const raw = String(addr["ip-address"] ?? addr.ip ?? "").trim();
      const host = ipv4Host(raw);
      if (!host || host.startsWith("127.")) continue;
      ips.push(host);
    }
  }
  return [...new Set(ips)];
}
