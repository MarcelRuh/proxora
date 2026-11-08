import { describe, expect, it } from "vitest";
import { parseWgShowDump } from "@/lib/wireguard-status";

describe("parseWgShowDump", () => {
  it("returns empty for blank dump", () => {
    expect(parseWgShowDump("")).toEqual([]);
    expect(parseWgShowDump(null)).toEqual([]);
  });

  it("parses peer rows and handshake age", () => {
    const nowSec = 1_700_000_180;
    const dump = [
      "priv\tpub0\t51820\toff",
      "peerPub\t(none)\t203.0.113.9:51820\t10.88.0.0/24\t1700000000\t1024\t2048\t25",
      "deadPeer\t(none)\t(none)\t10.88.0.5/32\t0\t0\t0\toff",
    ].join("\n");
    const peers = parseWgShowDump(dump, nowSec * 1000);
    expect(peers).toHaveLength(2);
    // peer-only dump (sidecar strips iface line)
    expect(parseWgShowDump(dump.split("\n").slice(1).join("\n"), nowSec * 1000)).toHaveLength(2);
    expect(peers[0]?.publicKey).toBe("peerPub");
    expect(peers[0]?.endpoint).toBe("203.0.113.9:51820");
    expect(peers[0]?.allowedIps).toBe("10.88.0.0/24");
    expect(peers[0]?.latestHandshakeAgeSec).toBe(180);
    expect(peers[0]?.handshakeOk).toBe(true);
    expect(peers[0]?.transferRx).toBe(1024);
    expect(peers[0]?.transferTx).toBe(2048);
    expect(peers[0]?.persistentKeepalive).toBe(25);
    expect(peers[1]?.latestHandshakeAt).toBeNull();
    expect(peers[1]?.handshakeOk).toBe(false);
    expect(peers[1]?.endpoint).toBe("");
  });

  it("marks stale handshakes", () => {
    const nowSec = 1_700_000_400;
    const dump = ["iface\tpub\t0\toff", "pk\t(none)\t1.2.3.4:1\t0.0.0.0/0\t1700000000\t1\t2\t25"].join("\n");
    const [peer] = parseWgShowDump(dump, nowSec * 1000);
    expect(peer?.latestHandshakeAgeSec).toBe(400);
    expect(peer?.handshakeOk).toBe(false);
  });
});
