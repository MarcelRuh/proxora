import { cidrContainsIpv4 } from "@/lib/wireguard-conf";
import { compareSemver } from "@/lib/version";
import type { WireguardRuntimePeer } from "@/lib/wireguard-status";

export type WireguardHint = {
  level: "info" | "warn" | "error";
  /** i18n key under peers.hint.* */
  code:
    | "disabled"
    | "down"
    | "downError"
    | "noRuntimePeer"
    | "handshakeStale"
    | "handshakeNever"
    | "peerAddress"
    | "allowedIps"
    | "peerSync"
    | "http"
    | "version"
    | "ok"
    | "healedAllowedIps";
  params?: Record<string, string>;
};

type HintInput = {
  enabled: boolean;
  up: boolean;
  error: string | null;
  allowedIPs: string;
  runtimePeers: WireguardRuntimePeer[];
  proxoraPeers: Array<{ id: string; name: string; address: string }>;
  peerSync: Record<string, { ok: boolean; error: string | null }>;
  reachability: Array<{
    peerId: string;
    name: string;
    ok: boolean;
    error: string | null;
    version?: string | null;
  }>;
  localVersion?: string | null;
  healedAllowedIps?: boolean;
};

function allowedCovers(allowedIPs: string, ip: string): boolean {
  const host = ip.trim().split("/")[0]?.trim() ?? "";
  if (!host) return false;
  return allowedIPs
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)
    .some((cidr) => cidrContainsIpv4(cidr, host));
}

/** Actionable diagnosis codes for the WireGuard UI (translated client-side). */
export function buildWireguardHints(input: HintInput): WireguardHint[] {
  const hints: WireguardHint[] = [];
  if (input.healedAllowedIps) {
    hints.push({ level: "info", code: "healedAllowedIps" });
  }
  if (!input.enabled) {
    hints.push({ level: "info", code: "disabled" });
    return hints;
  }
  if (!input.up) {
    hints.push(
      input.error
        ? { level: "error", code: "downError", params: { error: input.error } }
        : { level: "error", code: "down" },
    );
    return hints;
  }
  if (input.runtimePeers.length === 0) {
    hints.push({ level: "warn", code: "noRuntimePeer" });
  }
  const anyHandshake = input.runtimePeers.some((p) => p.handshakeOk);
  const anyHandshakeEver = input.runtimePeers.some((p) => p.latestHandshakeAt);
  if (input.runtimePeers.length > 0 && !anyHandshake) {
    hints.push({
      level: "error",
      code: anyHandshakeEver ? "handshakeStale" : "handshakeNever",
    });
  }
  for (const peer of input.proxoraPeers) {
    if (!peer.address) {
      hints.push({ level: "warn", code: "peerAddress", params: { name: peer.name } });
      continue;
    }
    if (!allowedCovers(input.allowedIPs, peer.address)) {
      hints.push({
        level: "error",
        code: "allowedIps",
        params: { name: peer.name, ip: peer.address, allowed: input.allowedIPs || "—" },
      });
    }
    const sync = input.peerSync[peer.id];
    if (sync && !sync.ok) {
      hints.push({
        level: "warn",
        code: "peerSync",
        params: { name: peer.name, error: sync.error ?? "—" },
      });
    }
    const reach = input.reachability.find((r) => r.peerId === peer.id);
    if (reach && !reach.ok) {
      hints.push({
        level: anyHandshake ? "error" : "warn",
        code: "http",
        params: { name: peer.name, error: reach.error ?? "—" },
      });
    }
    if (reach?.ok && reach.version && input.localVersion) {
      if (compareSemver(reach.version, input.localVersion) < 0) {
        hints.push({
          level: "info",
          code: "version",
          params: { name: peer.name, peer: reach.version, local: input.localVersion },
        });
      }
    }
  }
  if (!hints.some((h) => h.level === "error" || h.level === "warn") && anyHandshake) {
    hints.push({ level: "info", code: "ok" });
  }
  return hints;
}
