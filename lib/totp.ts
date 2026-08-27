import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { UnauthorizedError } from "@/lib/errors";
import { decryptSecret, encryptSecret } from "@/lib/crypto";

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const STEP_SECONDS = 30;
const DIGITS = 6;
const TICKET_TTL_MS = 5 * 60_000;

export function generateTotpSecret(bytes = 20): string {
  return encodeBase32(randomBytes(bytes));
}

export function totpOtpauthUrl(secret: string, username: string, issuer = "Proxora"): string {
  const label = encodeURIComponent(`${issuer}:${username}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

export function totpCode(secret: string, timeMs = Date.now(), step = STEP_SECONDS, digits = DIGITS): string {
  return hotp(decodeBase32(secret), Math.floor(timeMs / 1000 / step), digits);
}

export function verifyTotp(secret: string, code: string, window = 1, timeMs = Date.now()): boolean {
  const trimmed = code.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(trimmed)) return false;
  const expected = Buffer.from(trimmed);
  for (let i = -window; i <= window; i += 1) {
    const candidate = Buffer.from(totpCode(secret, timeMs + i * STEP_SECONDS * 1000));
    if (candidate.length === expected.length && timingSafeEqual(candidate, expected)) return true;
  }
  return false;
}

export function createTotpTicket(userId: string, ttlMs = TICKET_TTL_MS): string {
  return encryptSecret(JSON.stringify({ userId, exp: Date.now() + ttlMs }));
}

export function readTotpTicket(ticket: string): { userId: string; exp: number } {
  let parsed: { userId?: unknown; exp?: unknown };
  try {
    parsed = JSON.parse(decryptSecret(ticket)) as { userId?: unknown; exp?: unknown };
  } catch {
    throw new UnauthorizedError("Invalid or expired 2FA ticket");
  }
  if (typeof parsed.userId !== "string" || typeof parsed.exp !== "number" || parsed.exp < Date.now()) {
    throw new UnauthorizedError("Invalid or expired 2FA ticket");
  }
  return { userId: parsed.userId, exp: parsed.exp };
}

function hotp(key: Buffer, counter: number, digits: number): string {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", key).update(buf).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const bin =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff);
  return String(bin % 10 ** digits).padStart(digits, "0");
}

export function encodeBase32(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function decodeBase32(input: string): Buffer {
  const cleaned = input.toUpperCase().replace(/=+$/g, "").replace(/[\s-]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of cleaned) {
    const idx = BASE32.indexOf(ch);
    if (idx < 0) throw new Error("Invalid base32 secret");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}
