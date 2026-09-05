import { interfaceIpv4, isWireguardKey } from "@/lib/wireguard-keys";

export type WgConfPeer = {
  publicKey: string;
  endpoint?: string;
  allowedIPs: string;
  persistentKeepalive?: number;
};

/** Client config: one hub server, no ListenPort. */
export function buildWg0Conf(input: { privateKey: string; address: string; peers: WgConfPeer[] }): string {
  const lines = ["[Interface]", `PrivateKey = ${input.privateKey}`, `Address = ${input.address}`, ""];
  const seen = new Set<string>();
  for (const peer of input.peers) {
    const key = peer.publicKey.trim();
    if (!isWireguardKey(key) || seen.has(key)) continue;
    const allowed = peer.allowedIPs.trim();
    if (!allowed) continue;
    seen.add(key);
    lines.push("[Peer]");
    lines.push(`PublicKey = ${key}`);
    if (peer.endpoint?.trim()) lines.push(`Endpoint = ${peer.endpoint.trim()}`);
    lines.push(`AllowedIPs = ${allowed}`);
    const ka = peer.persistentKeepalive ?? 25;
    if (ka > 0) lines.push(`PersistentKeepalive = ${ka}`);
    lines.push("");
  }
  return `${lines.join("\n").trim()}\n`;
}

/** Stanza the WireGuard server admin adds for this Proxora. */
export function serverPeerSnippet(publicKey: string, address: string): string {
  const ip = interfaceIpv4(address.includes("/") ? address : `${address}/32`) ?? address.split("/")[0]?.trim();
  return `[Peer]\nPublicKey = ${publicKey}\nAllowedIPs = ${ip}/32\n`;
}
