import { ValidationError } from "@/lib/errors";

const BLOCKED_HOSTS = new Set(["localhost", "metadata.google.internal"]);

function ipv4Octets(host: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const parts = m.slice(1).map((n) => Number(n));
  if (parts.some((n) => n > 255)) return null;
  return parts;
}

function isPrivateIpv4(ip: number[]): boolean {
  const [a, b] = ip;
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  return false;
}

/** IPv4 embedded in an IPv6 literal (::ffff:a.b.c.d, ::ffff:7f00:1, ::a.b.c.d). */
function embeddedIpv4(v6: string): number[] | null {
  const dotted = /^(?:0*:)*(?:ffff:)?(\d{1,3}(?:\.\d{1,3}){3})$/.exec(v6.replace(/^::/, "0:"));
  if (dotted) return ipv4Octets(dotted[1]);
  const hex = /^(?:0*:)*ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(v6.replace(/^::/, "0:"));
  if (!hex) return null;
  const hi = parseInt(hex[1], 16);
  const lo = parseInt(hex[2], 16);
  return [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff];
}

function isPrivateIpv6(v6: string): boolean {
  if (v6 === "::" || v6 === "::1" || /^0*(:0*)*:0*1$/.test(v6)) return true;
  const first = v6.split(":")[0] ?? "";
  const head = parseInt(first || "0", 16);
  if ((head & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((head & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  const v4 = embeddedIpv4(v6);
  return v4 ? isPrivateIpv4(v4) : false;
}

export function isPrivateOrLocalHostname(host: string): boolean {
  // URL#hostname keeps IPv6 literals bracketed ("[::1]").
  const name = host.trim().toLowerCase().replace(/\.+$/, "").replace(/^\[(.*)\]$/, "$1");
  if (!name) return true;
  if (BLOCKED_HOSTS.has(name) || name.endsWith(".localhost") || name.endsWith(".local")) return true;
  if (name === "0.0.0.0") return true;
  if (name.includes(":")) return isPrivateIpv6(name);
  const ip = ipv4Octets(name);
  return ip ? isPrivateIpv4(ip) : false;
}

/** Loopback / link-local / metadata only (LAN targets stay allowed for push). */
function isLoopbackOrMetadata(host: string): boolean {
  const name = host.trim().toLowerCase().replace(/\.+$/, "").replace(/^\[(.*)\]$/, "$1");
  if (!name || name === "localhost" || name.endsWith(".localhost") || name === "metadata.google.internal") return true;
  if (name === "0.0.0.0") return true;
  if (name.includes(":")) {
    if (name === "::" || name === "::1" || /^0*(:0*)*:0*1$/.test(name)) return true;
    const head = parseInt(name.split(":")[0] || "0", 16);
    if ((head & 0xffc0) === 0xfe80) return true;
    const v4 = embeddedIpv4(name);
    return v4 ? v4[0] === 127 || v4[0] === 0 || (v4[0] === 169 && v4[1] === 254) : false;
  }
  const ip = ipv4Octets(name);
  return ip ? ip[0] === 127 || ip[0] === 0 || (ip[0] === 169 && ip[1] === 254) : false;
}

/** HTTPS webhooks only; blocks loopback, link-local, and RFC1918 literals. */
export function assertSafeWebhookUrl(url: string): string {
  const trimmed = url.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new ValidationError("Invalid webhook URL");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new ValidationError("Webhook URL must be http(s)");
  }
  if (parsed.username || parsed.password) {
    throw new ValidationError("Webhook URL must not include credentials");
  }
  if (isPrivateOrLocalHostname(parsed.hostname)) {
    throw new ValidationError("Webhook URL must not point at a private or local address");
  }
  return parsed.toString();
}

/** Push endpoints may be LAN ntfy/UnifiedPush; still block credentials, loopback, and cloud metadata. */
export function assertSafePushUrl(url: string): string {
  const trimmed = url.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new ValidationError("Invalid push URL");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new ValidationError("Push URL must be http(s)");
  }
  if (parsed.username || parsed.password) {
    throw new ValidationError("Push URL must not include credentials");
  }
  if (isLoopbackOrMetadata(parsed.hostname)) {
    throw new ValidationError("Invalid push URL");
  }
  return parsed.toString();
}
