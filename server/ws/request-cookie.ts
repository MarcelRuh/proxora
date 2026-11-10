import type { IncomingMessage } from "node:http";

/** Read one cookie from an upgrade request. Malformed %-escapes fall back to the raw value instead of throwing. */
export function cookieValue(req: IncomingMessage, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k !== name) continue;
    const raw = rest.join("=");
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return undefined;
}
