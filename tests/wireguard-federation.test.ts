import { describe, expect, it } from "vitest";
import { encodeWireguardInvite, parseWireguardInvite } from "@/lib/wireguard-invite";
import { buildWg0Conf, serverPeerSnippet } from "@/lib/wireguard-conf";
import { generateWireguardKeypair, isWireguardKey } from "@/lib/wireguard-keys";
import { federationActionLevel, shareAllows } from "@/lib/federation-access";

describe("wireguard keys", () => {
  it("generates 32-byte keypairs", () => {
    const pair = generateWireguardKeypair();
    expect(isWireguardKey(pair.privateKey)).toBe(true);
    expect(isWireguardKey(pair.publicKey)).toBe(true);
    expect(pair.privateKey).not.toBe(pair.publicKey);
  });
});

describe("wireguard client conf", () => {
  it("writes a hub client with keepalive and no ListenPort", () => {
    const server = generateWireguardKeypair();
    const conf = buildWg0Conf({
      privateKey: "client-private",
      address: "10.88.0.2/24",
      peers: [
        {
          publicKey: server.publicKey,
          endpoint: "192.168.10.50:51820",
          allowedIPs: "10.88.0.0/24",
          persistentKeepalive: 25,
        },
        {
          publicKey: server.publicKey,
          endpoint: "duplicate",
          allowedIPs: "10.88.0.0/24",
        },
      ],
    });
    expect(conf).toContain("[Interface]");
    expect(conf).toContain("Address = 10.88.0.2/24");
    expect(conf).not.toMatch(/ListenPort/);
    expect(conf).toContain(`PublicKey = ${server.publicKey}`);
    expect(conf).toContain("Endpoint = 192.168.10.50:51820");
    expect(conf).toContain("AllowedIPs = 10.88.0.0/24");
    expect(conf).toContain("PersistentKeepalive = 25");
    expect(conf.split("[Peer]")).toHaveLength(2);
  });

  it("does not add colleague Proxora keys as WireGuard peers", () => {
    const server = generateWireguardKeypair();
    const colleague = generateWireguardKeypair();
    const conf = buildWg0Conf({
      privateKey: "x",
      address: "10.88.0.2/24",
      peers: [
        { publicKey: server.publicKey, endpoint: "wg:51820", allowedIPs: "10.88.0.0/24" },
      ],
    });
    expect(conf).not.toContain(colleague.publicKey);
  });

  it("builds the stanza for the external WG server", () => {
    const keys = generateWireguardKeypair();
    expect(serverPeerSnippet(keys.publicKey, "10.88.0.2/24")).toBe(
      `[Peer]\nPublicKey = ${keys.publicKey}\nAllowedIPs = 10.88.0.2/32\n`,
    );
  });
});

describe("wireguard invite", () => {
  it("round-trips invite payloads", () => {
    const keys = generateWireguardKeypair();
    const encoded = encodeWireguardInvite({
      v: 1,
      name: "Studio",
      publicKey: keys.publicKey,
      endpoint: "192.168.10.50:51820",
      address: "10.88.0.2",
      listenPort: 51820,
      token: "secret-token",
    });
    expect(encoded.startsWith("proxora1.")).toBe(true);
    expect(parseWireguardInvite(encoded)).toMatchObject({
      name: "Studio",
      publicKey: keys.publicKey,
      address: "10.88.0.2",
      token: "secret-token",
    });
  });

  it("accepts invites without a public UDP endpoint", () => {
    const keys = generateWireguardKeypair();
    const encoded = encodeWireguardInvite({
      v: 1,
      name: "Studio",
      publicKey: keys.publicKey,
      endpoint: "",
      address: "10.88.0.3",
      listenPort: 51820,
      token: "secret-token",
    });
    expect(parseWireguardInvite(encoded).address).toBe("10.88.0.3");
  });

  it("rejects garbage", () => {
    expect(() => parseWireguardInvite("nope")).toThrow(/Invalid invite/);
  });
});

describe("federation share levels", () => {
  it("maps Proxmox calls to share levels", () => {
    expect(federationActionLevel("GET", "/nodes/pve/qemu")).toBe("view");
    expect(federationActionLevel("POST", "/nodes/pve/qemu")).toBe("create");
    expect(federationActionLevel("POST", "/nodes/pve/qemu/100/status/start")).toBe("control");
    expect(federationActionLevel("POST", "/nodes/pve/status/reboot")).toBe("deny");
    expect(federationActionLevel("POST", "/nodes/pve/termproxy")).toBe("deny");
    expect(federationActionLevel("POST", "/nodes/pve/qemu/100/termproxy")).toBe("control");
    expect(shareAllows("view", "control")).toBe(false);
    expect(shareAllows("create", "control")).toBe(true);
    expect(shareAllows("control", "deny")).toBe(false);
  });
});
