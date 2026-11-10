import type { IncomingMessage } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { clientIpFromNode, PEER_IP_HEADER, resolveClientIp, stampPeerIp, trustProxy } from "@/server/http/client-ip";

const headers = (map: Record<string, string>) => (name: string) => map[name];

describe("client IP", () => {
  afterEach(() => {
    delete process.env.TRUST_PROXY;
  });

  it("parses the opt-in flag", () => {
    expect(trustProxy(undefined)).toBe(false);
    expect(trustProxy("false")).toBe(false);
    expect(trustProxy("true")).toBe(true);
    expect(trustProxy("1")).toBe(true);
  });

  it("ignores forwarded headers unless the proxy is trusted", () => {
    const spoofed = headers({ "x-real-ip": "1.1.1.1", "x-forwarded-for": "2.2.2.2" });
    expect(resolveClientIp(spoofed, "10.0.0.9", false)).toBe("10.0.0.9");
    expect(resolveClientIp(spoofed, undefined, false)).toBeUndefined();
  });

  it("uses X-Real-IP, then the rightmost X-Forwarded-For hop behind a trusted proxy", () => {
    expect(resolveClientIp(headers({ "x-real-ip": "1.1.1.1" }), "10.0.0.9", true)).toBe("1.1.1.1");
    expect(resolveClientIp(headers({ "x-forwarded-for": "6.6.6.6, 3.3.3.3" }), "10.0.0.9", true)).toBe("3.3.3.3");
    expect(resolveClientIp(headers({}), "10.0.0.9", true)).toBe("10.0.0.9");
  });

  it("unwraps IPv4-mapped peers", () => {
    expect(resolveClientIp(headers({}), "::ffff:192.168.1.5", false)).toBe("192.168.1.5");
    expect(resolveClientIp(headers({}), "2001:db8::1", false)).toBe("2001:db8::1");
  });

  it("reads Node requests and WebSocket upgrades the same way", () => {
    const req = {
      headers: { "x-forwarded-for": "7.7.7.7" },
      socket: { remoteAddress: "10.0.0.2" },
    } as unknown as IncomingMessage;
    expect(clientIpFromNode(req)).toBe("10.0.0.2");
    process.env.TRUST_PROXY = "true";
    expect(clientIpFromNode(req)).toBe("7.7.7.7");
  });

  it("overwrites a client-sent peer header with the socket address", () => {
    const req = {
      headers: { [PEER_IP_HEADER]: "1.2.3.4" },
      socket: { remoteAddress: "10.0.0.3" },
    } as unknown as IncomingMessage;
    stampPeerIp(req);
    expect(req.headers[PEER_IP_HEADER]).toBe("10.0.0.3");
    const noSocket = { headers: { [PEER_IP_HEADER]: "1.2.3.4" }, socket: {} } as unknown as IncomingMessage;
    stampPeerIp(noSocket);
    expect(noSocket.headers[PEER_IP_HEADER]).toBeUndefined();
  });
});
