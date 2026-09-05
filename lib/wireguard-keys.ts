import { createPrivateKey, createPublicKey, generateKeyPairSync } from "node:crypto";

function derRaw32(der: Buffer): Buffer {
  if (der.length < 32) throw new Error("Unexpected key encoding");
  return der.subarray(der.length - 32);
}

const X25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b656e04220420", "hex");

export function generateWireguardKeypair(): { privateKey: string; publicKey: string } {
  const pair = generateKeyPairSync("x25519");
  const privDer = pair.privateKey.export({ type: "pkcs8", format: "der" });
  const pubDer = pair.publicKey.export({ type: "spki", format: "der" });
  return {
    privateKey: derRaw32(privDer).toString("base64"),
    publicKey: derRaw32(pubDer).toString("base64"),
  };
}

export function publicKeyFromPrivate(privateKey: string): string {
  if (!isWireguardKey(privateKey)) throw new Error("Invalid WireGuard private key");
  const raw = Buffer.from(privateKey.trim(), "base64");
  const key = createPrivateKey({ key: Buffer.concat([X25519_PKCS8_PREFIX, raw]), format: "der", type: "pkcs8" });
  const spki = createPublicKey(key).export({ type: "spki", format: "der" });
  return derRaw32(spki).toString("base64");
}

export function isWireguardKey(value: string): boolean {
  try {
    const raw = Buffer.from(value.trim(), "base64");
    return raw.length === 32;
  } catch {
    return false;
  }
}

export function interfaceIpv4(cidr: string): string | null {
  const host = cidr.trim().split("/")[0]?.trim() ?? "";
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(host) ? host : null;
}

export function peerAllowedIps(address: string, fallback: string): string {
  const listed = fallback.trim();
  if (listed) return listed;
  const ip = interfaceIpv4(address.includes("/") ? address : `${address}/32`);
  return ip ? `${ip}/32` : "";
}
