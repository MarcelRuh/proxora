import { describe, expect, it } from "vitest";
import { encodeWireguardInvite, parseWireguardInvite } from "@/lib/wireguard-invite";
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

describe("wireguard invite", () => {
  it("round-trips invite payloads", () => {
    const keys = generateWireguardKeypair();
    const encoded = encodeWireguardInvite({
      v: 1,
      name: "Studio",
      publicKey: keys.publicKey,
      endpoint: "203.0.113.10:51820",
      address: "10.88.0.1",
      listenPort: 51820,
      token: "secret-token",
    });
    expect(encoded.startsWith("proxora1.")).toBe(true);
    expect(parseWireguardInvite(encoded)).toMatchObject({
      name: "Studio",
      publicKey: keys.publicKey,
      endpoint: "203.0.113.10:51820",
      address: "10.88.0.1",
      token: "secret-token",
    });
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
