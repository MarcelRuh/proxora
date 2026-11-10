import type { IncomingMessage } from "node:http";

/**
 * Set by the custom server from the TCP peer address on every request, after
 * dropping any client-sent value, so route handlers can see the real peer.
 */
export const PEER_IP_HEADER = "x-proxora-peer-ip";

/** Forwarded headers are only honoured behind a reverse proxy the operator opted into. */
export function trustProxy(value = process.env.TRUST_PROXY): boolean {
  const v = String(value ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

function cleanIp(raw: string | null | undefined): string | undefined {
  const ip = String(raw ?? "").trim();
  if (!ip) return undefined;
  return ip.startsWith("::ffff:") && ip.includes(".") ? ip.slice(7) : ip;
}

export function resolveClientIp(
  header: (name: string) => string | null | undefined,
  peer: string | null | undefined,
  trusted = trustProxy(),
): string | undefined {
  if (trusted) {
    const real = cleanIp(header("x-real-ip"));
    if (real) return real;
    // Rightmost hop is appended by the nearest proxy; left entries are client-controlled.
    const forwarded = String(header("x-forwarded-for") ?? "")
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
      .at(-1);
    const hop = cleanIp(forwarded);
    if (hop) return hop;
  }
  return cleanIp(peer);
}

function nodeHeader(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value.join(", ") : value;
}

/** Client IP for raw Node requests and WebSocket upgrades. */
export function clientIpFromNode(req: IncomingMessage): string | undefined {
  return resolveClientIp((name) => nodeHeader(req, name), req.socket?.remoteAddress);
}

/** Overwrites the internal peer header so clients cannot spoof it. */
export function stampPeerIp(req: IncomingMessage) {
  const peer = req.socket?.remoteAddress;
  if (peer) req.headers[PEER_IP_HEADER] = peer;
  else delete req.headers[PEER_IP_HEADER];
}
