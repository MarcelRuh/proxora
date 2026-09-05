import { describe, expect, it } from "vitest";
import { encodeWireguardInvite, parseWireguardInvite } from "@/lib/wireguard-invite";
import { buildWg0Conf, parseWgQuickConf, sanitizeClientAllowedIps, serverPeerSnippet } from "@/lib/wireguard-conf";
import { generateWireguardKeypair, isWireguardKey, publicKeyFromPrivate } from "@/lib/wireguard-keys";
import { federationActionLevel, shareAllows } from "@/lib/federation-access";

describe("wireguard keys", () => {
  it("generates 32-byte keypairs", () => {
    const pair = generateWireguardKeypair();
    expect(isWireguardKey(pair.privateKey)).toBe(true);
    expect(isWireguardKey(pair.publicKey)).toBe(true);
    expect(pair.privateKey).not.toBe(pair.publicKey);
  });

  it("derives the matching public key from a private key", () => {
    const pair = generateWireguardKeypair();
    expect(publicKeyFromPrivate(pair.privateKey)).toBe(pair.publicKey);
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

describe("wireguard conf import", () => {
  it("parses a wg-quick client file", () => {
    const client = generateWireguardKeypair();
    const server = generateWireguardKeypair();
    const psk = generateWireguardKeypair().privateKey;
    const parsed = parseWgQuickConf(`
# comment
[Interface]
PrivateKey = ${client.privateKey}
Address = 10.88.0.2/24, fd00::2/64
DNS = 1.1.1.1
ListenPort = 51820

[Peer]
PublicKey = ${server.publicKey}
PresharedKey = ${psk}
Endpoint = 192.168.10.50:51820
AllowedIPs = 10.88.0.0/24, 192.168.0.0/16
PersistentKeepalive = 25
`);
    expect(parsed.privateKey).toBe(client.privateKey);
    expect(parsed.address).toBe("10.88.0.2/24");
    expect(parsed.peers).toHaveLength(1);
    expect(parsed.peers[0]).toMatchObject({
      publicKey: server.publicKey,
      presharedKey: psk,
      endpoint: "192.168.10.50:51820",
      allowedIPs: "10.88.0.0/24, 192.168.0.0/16",
      persistentKeepalive: 25,
    });
  });

  it("rejects configs without a peer or ipv4 address", () => {
    const client = generateWireguardKeypair();
    expect(() => parseWgQuickConf(`[Interface]\nPrivateKey = ${client.privateKey}\n`)).toThrow(/Address|Peer/);
    expect(() => parseWgQuickConf("not a conf")).toThrow(/Interface/);
  });

  it("writes PresharedKey into the generated conf", () => {
    const server = generateWireguardKeypair();
    const psk = generateWireguardKeypair().privateKey;
    const conf = buildWg0Conf({
      privateKey: "x",
      address: "10.88.0.2/24",
      peers: [
        {
          publicKey: server.publicKey,
          endpoint: "wg:51820",
          allowedIPs: "10.88.0.0/24",
          presharedKey: psk,
        },
      ],
    });
    expect(conf).toContain(`PresharedKey = ${psk}`);
  });

  it("drops full-tunnel AllowedIPs so Docker DNS still works", () => {
    expect(sanitizeClientAllowedIps("0.0.0.0/0, ::/0", "10.88.0.2/24")).toBe("10.88.0.0/24");
    expect(sanitizeClientAllowedIps("10.88.0.0/24, 0.0.0.0/0", "10.88.0.2/24")).toBe("10.88.0.0/24");
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
