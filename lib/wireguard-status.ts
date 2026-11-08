export type WireguardRuntimePeer = {
  publicKey: string;
  endpoint: string;
  allowedIps: string;
  latestHandshakeAt: string | null;
  latestHandshakeAgeSec: number | null;
  transferRx: number;
  transferTx: number;
  persistentKeepalive: number;
  handshakeOk: boolean;
};

export type WireguardRuntimeStatus = {
  up: boolean;
  error: string | null;
  checkedAt: string | null;
  peers: WireguardRuntimePeer[];
  log: string[];
};

const HANDSHAKE_FRESH_SEC = 180;

/** Parse `wg show <iface> dump` (without private key leakage to callers). */
export function parseWgShowDump(dump: string | null | undefined, nowMs = Date.now()): WireguardRuntimePeer[] {
  const text = String(dump ?? "").trim();
  if (!text) return [];
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const peers: WireguardRuntimePeer[] = [];
  // Accept full `wg show dump` (iface + peers) or peer-only dumps from the sidecar.
  for (const line of lines) {
    const parts = line.split("\t");
    // Interface row has 4 columns; peer rows have ≥8.
    if (parts.length < 8) continue;
    const publicKey = parts[0] ?? "";
    const endpoint = parts[2] && parts[2] !== "(none)" ? parts[2] : "";
    const allowedIps = parts[3] && parts[3] !== "(none)" ? parts[3] : "";
    const handshakeSec = Number(parts[4] ?? 0) || 0;
    const transferRx = Number(parts[5] ?? 0) || 0;
    const transferTx = Number(parts[6] ?? 0) || 0;
    const persistentKeepalive = Number(parts[7] ?? 0) || 0;
    const latestHandshakeAt = handshakeSec > 0 ? new Date(handshakeSec * 1000).toISOString() : null;
    const latestHandshakeAgeSec =
      handshakeSec > 0 ? Math.max(0, Math.floor(nowMs / 1000) - handshakeSec) : null;
    peers.push({
      publicKey,
      endpoint,
      allowedIps,
      latestHandshakeAt,
      latestHandshakeAgeSec,
      transferRx,
      transferTx,
      persistentKeepalive,
      handshakeOk: latestHandshakeAgeSec != null && latestHandshakeAgeSec <= HANDSHAKE_FRESH_SEC,
    });
  }
  return peers;
}

export function emptyWireguardRuntimeStatus(): WireguardRuntimeStatus {
  return { up: false, error: null, checkedAt: null, peers: [], log: [] };
}
