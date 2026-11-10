import type { IncomingMessage } from "node:http";
import { describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { isAllowedOrigin } from "@/server/http/respond";
import { browserGone, dropUpstreamIfBrowserGone, headerRequest } from "@/server/ws/request-headers";

function req(headers: Record<string, string>, url = "/api/ws/console?hostId=h1"): IncomingMessage {
  return { headers, url } as unknown as IncomingMessage;
}

describe("console websocket origin", () => {
  it("accepts same-origin upgrades", () => {
    const r = req({ host: "proxora.local:3000", origin: "http://proxora.local:3000" });
    expect(isAllowedOrigin(headerRequest(r), "http://proxora.local:3000")).toBe(true);
  });

  it("rejects cross-site upgrades", () => {
    const r = req({ host: "proxora.local:3000", origin: "https://evil.example" });
    expect(isAllowedOrigin(headerRequest(r), "https://evil.example")).toBe(false);
  });

  it("carries the upgrade headers and forwarded proto", () => {
    const r = req({ host: "proxora.local", "x-forwarded-proto": "https, http", cookie: "a=b" });
    const built = headerRequest(r);
    expect(built.url).toBe("https://proxora.local/api/ws/console?hostId=h1");
    expect(built.headers.get("cookie")).toBe("a=b");
  });
});

describe("upstream cleanup", () => {
  const sock = (readyState: number) => ({ readyState, terminate: vi.fn() }) as unknown as WebSocket & { terminate: ReturnType<typeof vi.fn> };

  it("detects a browser that left during setup", () => {
    expect(browserGone(sock(WebSocket.OPEN))).toBe(false);
    expect(browserGone(sock(WebSocket.CLOSING))).toBe(true);
    expect(browserGone(sock(WebSocket.CLOSED))).toBe(true);
  });

  it("terminates the upstream socket only when the browser is gone", () => {
    const remote = sock(WebSocket.CONNECTING);
    expect(dropUpstreamIfBrowserGone(sock(WebSocket.OPEN), remote)).toBe(false);
    expect(remote.terminate).not.toHaveBeenCalled();
    expect(dropUpstreamIfBrowserGone(sock(WebSocket.CLOSED), remote)).toBe(true);
    expect(remote.terminate).toHaveBeenCalledOnce();
  });
});
