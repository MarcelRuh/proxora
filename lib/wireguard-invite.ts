export const WG_INVITE_PREFIX_V1 = "proxora1.";
export const WG_INVITE_PREFIX = "proxora2.";

export type WireguardInvite = {
  v: 1 | 2;
  name: string;
  token: string;
  publicKey?: string;
  address?: string;
  endpoint?: string;
  listenPort?: number;
};

export function encodeWireguardInvite(invite: { name: string; token: string }): string {
  const json = JSON.stringify({ v: 2, name: invite.name.trim(), token: invite.token });
  return `${WG_INVITE_PREFIX}${Buffer.from(json, "utf8").toString("base64url")}`;
}

export function parseWireguardInvite(raw: string): WireguardInvite {
  const trimmed = raw.trim().replace(/\s+/g, "");
  if (trimmed.startsWith(WG_INVITE_PREFIX)) {
    const rec = decodeJson(trimmed.slice(WG_INVITE_PREFIX.length));
    const name = String(rec.name ?? "").trim();
    const token = String(rec.token ?? "").trim();
    if (!name || !token) throw new Error("Invalid invite");
    return { v: 2, name, token };
  }
  if (trimmed.startsWith(WG_INVITE_PREFIX_V1)) {
    const rec = decodeJson(trimmed.slice(WG_INVITE_PREFIX_V1.length));
    const name = String(rec.name ?? "").trim();
    const token = String(rec.token ?? "").trim();
    const address = String(rec.address ?? "").trim();
    const publicKey = String(rec.publicKey ?? "").trim() || undefined;
    if (!name || !token) throw new Error("Invalid invite");
    return {
      v: 1,
      name,
      token,
      publicKey,
      address: address || undefined,
      endpoint: String(rec.endpoint ?? "").trim() || undefined,
      listenPort: Number(rec.listenPort ?? 51820) || 51820,
    };
  }
  throw new Error("Invalid invite");
}

function decodeJson(b64: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(b64, "base64url").toString("utf8"));
  } catch {
    throw new Error("Invalid invite");
  }
  if (!parsed || typeof parsed !== "object") throw new Error("Invalid invite");
  return parsed as Record<string, unknown>;
}
