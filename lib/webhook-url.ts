import { ValidationError } from "@/lib/errors";

const BLOCKED_HOSTS = new Set(["localhost", "metadata.google.internal"]);

function ipv4Octets(host: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const parts = m.slice(1).map((n) => Number(n));
  if (parts.some((n) => n > 255)) return null;
  return parts;
}

export function isPrivateOrLocalHostname(host: string): boolean {
  const name = host.trim().toLowerCase().replace(/\.+$/, "");
  if (!name) return true;
  if (BLOCKED_HOSTS.has(name) || name.endsWith(".localhost") || name.endsWith(".local")) return true;
  if (name === "::1" || name === "0.0.0.0" || name.startsWith("fe80:") || name.startsWith("fc") || name.startsWith("fd")) {
    return true;
  }
  const ip = ipv4Octets(name);
  if (!ip) return false;
  const [a, b] = ip;
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
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
  const host = parsed.hostname.trim().toLowerCase().replace(/\.+$/, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host === "metadata.google.internal") {
    throw new ValidationError("Invalid push URL");
  }
  if (host === "::1" || host === "0.0.0.0" || host === "127.0.0.1" || host.startsWith("169.254.")) {
    throw new ValidationError("Invalid push URL");
  }
  return parsed.toString();
}
