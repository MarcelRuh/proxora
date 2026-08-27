export const GUEST_IP_NETWORKS = [
  { id: "192.168.178.0", prefix: 24, gateway: "192.168.178.1" },
  { id: "192.168.1.0", prefix: 24, gateway: "192.168.1.1" },
  { id: "192.168.2.0", prefix: 24, gateway: "192.168.2.1" },
] as const;

export type GuestIpNetworkId = (typeof GUEST_IP_NETWORKS)[number]["id"];

export const DEFAULT_GUEST_NETWORK: GuestIpNetworkId = "192.168.178.0";

export function guestIpNetwork(id: string) {
  return GUEST_IP_NETWORKS.find((n) => n.id === id) ?? GUEST_IP_NETWORKS[0];
}

/** Last octet follows the VMID: 242 → 192.168.178.242 */
export function guestIpFromVmid(networkId: string, vmid: number): string | null {
  if (!Number.isInteger(vmid) || vmid < 1 || vmid > 254) return null;
  const net = guestIpNetwork(networkId);
  const [a, b, c] = net.id.split(".");
  if (!a || !b || !c) return null;
  return `${a}.${b}.${c}.${vmid}`;
}

export function guestCidrFromVmid(networkId: string, vmid: number): string {
  const ip = guestIpFromVmid(networkId, vmid);
  return ip ? `${ip}/${guestIpNetwork(networkId).prefix}` : "";
}

export function guestGateway(networkId: string): string {
  return guestIpNetwork(networkId).gateway;
}
