import type { IncomingMessage } from "node:http";
import { WebSocket } from "ws";

/** Fetch-style Request carrying the upgrade request's headers, for origin checks. */
export function headerRequest(req: IncomingMessage): Request {
  const host = req.headers.host || "localhost";
  const forwarded = String(req.headers["x-forwarded-proto"] ?? "")
    .split(",")[0]
    ?.trim();
  const proto = forwarded || "http";
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (!value) continue;
    headers.set(key, Array.isArray(value) ? value.join(", ") : value);
  }
  return new Request(`${proto}://${host}${req.url ?? "/"}`, { method: "GET", headers });
}

/** True once the browser side is gone, e.g. it disconnected while the proxy was still setting up. */
export function browserGone(browser: WebSocket): boolean {
  return browser.readyState === WebSocket.CLOSING || browser.readyState === WebSocket.CLOSED;
}

/** Drops an upstream socket whose browser already left, so it does not linger unpiped. */
export function dropUpstreamIfBrowserGone(browser: WebSocket, remote: WebSocket): boolean {
  if (!browserGone(browser)) return false;
  try {
    remote.terminate();
  } catch {
    /* ignore */
  }
  return true;
}
