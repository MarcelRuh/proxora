import { describe, expect, it } from "vitest";
import { buildWireguardHints } from "@/lib/wireguard-hints";
import type { WireguardRuntimePeer } from "@/lib/wireguard-status";

const peer = (partial: Partial<WireguardRuntimePeer> = {}): WireguardRuntimePeer => ({
  publicKey: "pk",
  endpoint: "1.2.3.4:51820",
  allowedIps: "192.168.1.0/24",
  latestHandshakeAt: new Date().toISOString(),
  latestHandshakeAgeSec: 30,
  transferRx: 1,
  transferTx: 1,
  persistentKeepalive: 25,
  handshakeOk: true,
  ...partial,
});

describe("buildWireguardHints", () => {
  it("reports disabled tunnel", () => {
    const hints = buildWireguardHints({
      enabled: false,
      up: false,
      error: null,
      allowedIPs: "192.168.1.0/24",
      runtimePeers: [],
      proxoraPeers: [],
      peerSync: {},
      reachability: [],
    });
    expect(hints.map((h) => h.code)).toEqual(["disabled"]);
  });

  it("reports missing AllowedIPs coverage", () => {
    const hints = buildWireguardHints({
      enabled: true,
      up: true,
      error: null,
      allowedIPs: "10.88.0.0/24",
      runtimePeers: [peer()],
      proxoraPeers: [{ id: "p1", name: "Ralf", address: "192.168.1.246" }],
      peerSync: {},
      reachability: [],
    });
    expect(hints.some((h) => h.code === "allowedIps")).toBe(true);
  });

  it("healed AllowedIPs plus healthy handshake yields ok", () => {
    const hints = buildWireguardHints({
      enabled: true,
      up: true,
      error: null,
      allowedIPs: "192.168.1.0/24",
      runtimePeers: [peer()],
      proxoraPeers: [{ id: "p1", name: "Ralf", address: "192.168.1.246" }],
      peerSync: { p1: { ok: true, error: null } },
      reachability: [{ peerId: "p1", name: "Ralf", ok: true, error: null, version: "2.4.3" }],
      localVersion: "2.4.3",
      healedAllowedIps: true,
    });
    expect(hints.map((h) => h.code)).toEqual(["healedAllowedIps", "ok"]);
  });

  it("flags older peer versions", () => {
    const hints = buildWireguardHints({
      enabled: true,
      up: true,
      error: null,
      allowedIPs: "192.168.1.0/24",
      runtimePeers: [peer()],
      proxoraPeers: [{ id: "p1", name: "Ralf", address: "192.168.1.246" }],
      peerSync: {},
      reachability: [{ peerId: "p1", name: "Ralf", ok: true, error: null, version: "2.3.6" }],
      localVersion: "2.4.3",
    });
    const version = hints.find((h) => h.code === "version");
    expect(version?.params).toEqual({ name: "Ralf", peer: "2.3.6", local: "2.4.3" });
  });

  it("reports never-seen handshake", () => {
    const hints = buildWireguardHints({
      enabled: true,
      up: true,
      error: null,
      allowedIPs: "192.168.1.0/24",
      runtimePeers: [peer({ handshakeOk: false, latestHandshakeAt: null, latestHandshakeAgeSec: null })],
      proxoraPeers: [],
      peerSync: {},
      reachability: [],
    });
    expect(hints.map((h) => h.code)).toContain("handshakeNever");
  });
});
