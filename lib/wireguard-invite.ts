import { isWireguardKey } from "@/lib/wireguard-keys";

export const WG_INVITE_PREFIX = "proxora1.";

export type WireguardInvite = {
  v: 1;
  name: string;
  publicKey: string;
  endpoint: string;
  address: string;
  listenPort: number;
  token: string;
};

export function encodeWireguardInvite(invite: WireguardInvite): string {
  const json = JSON.stringify(invite);
  return `${WG_INVITE_PREFIX}${Buffer.from(json, "utf8").toString("base64url")}`;
}

export function parseWireguardInvite(raw: string): WireguardInvite {
  const trimmed = raw.trim().replace(/\s+/g, "");
  if (!trimmed.startsWith(WG_INVITE_PREFIX)) {
    throw new Error("Invalid invite");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(trimmed.slice(WG_INVITE_PREFIX.length), "base64url").toString("utf8"));
  } catch {
    throw new Error("Invalid invite");
  }
  if (!parsed || typeof parsed !== "object") throw new Error("Invalid invite");
  const rec = parsed as Record<string, unknown>;
  const name = String(rec.name ?? "").trim();
  const publicKey = String(rec.publicKey ?? "").trim();
  const address = String(rec.address ?? "").trim();
  const token = String(rec.token ?? "").trim();
  const endpoint = String(rec.endpoint ?? "").trim();
  const listenPort = Number(rec.listenPort ?? 51820) || 51820;
  if (!name || !isWireguardKey(publicKey) || !interfaceIpv4ish(address) || !token) {
    throw new Error("Invalid invite");
  }
  if (!Number.isInteger(listenPort) || listenPort < 1 || listenPort > 65535) {
    throw new Error("Invalid invite");
  }
  return { v: 1, name, publicKey, endpoint, address, listenPort, token };
}

function interfaceIpv4ish(value: string): boolean {
  const host = value.split("/")[0]?.trim() ?? "";
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(host);
}
