import { randomBytes, timingSafeEqual } from "node:crypto";
import { sha256 } from "@/lib/crypto";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LEN = 8;

export function generateRecoveryCodes(count = 10): string[] {
  const codes = new Set<string>();
  while (codes.size < count) {
    const bytes = randomBytes(CODE_LEN);
    let raw = "";
    for (let i = 0; i < CODE_LEN; i += 1) {
      raw += ALPHABET[bytes[i]! % ALPHABET.length];
    }
    codes.add(`${raw.slice(0, 4)}-${raw.slice(4)}`);
  }
  return [...codes];
}

export function normalizeRecoveryCode(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function hashRecoveryCode(code: string): string {
  return sha256(normalizeRecoveryCode(code));
}

export function hashRecoveryCodes(codes: string[]): string[] {
  return codes.map(hashRecoveryCode);
}

export function consumeRecoveryCode(hashes: string[], code: string): string[] | null {
  const want = Buffer.from(hashRecoveryCode(code), "utf8");
  let index = -1;
  for (let i = 0; i < hashes.length; i += 1) {
    const have = Buffer.from(hashes[i] ?? "", "utf8");
    if (have.length === want.length && timingSafeEqual(have, want)) {
      index = i;
      break;
    }
  }
  if (index < 0) return null;
  return hashes.filter((_, i) => i !== index);
}

export function looksLikeRecoveryCode(value: string): boolean {
  const normalized = normalizeRecoveryCode(value);
  return normalized.length === CODE_LEN && /^[A-Z0-9]+$/.test(normalized);
}
