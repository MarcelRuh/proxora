import { afterEach, describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, sha256 } from "@/lib/crypto";

describe("secret encryption", () => {
  const previous = process.env.ENCRYPTION_KEY;

  afterEach(() => {
    process.env.ENCRYPTION_KEY = previous;
  });

  it("round-trips API token secrets", () => {
    process.env.ENCRYPTION_KEY = "a".repeat(64);
    const secret = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    const encrypted = encryptSecret(secret);
    expect(encrypted).not.toContain(secret);
    expect(decryptSecret(encrypted)).toBe(secret);
  });

  it("produces different ciphertext for the same secret", () => {
    process.env.ENCRYPTION_KEY = "unit-test-encryption-key-32b!!!!";
    expect(encryptSecret("token")).not.toBe(encryptSecret("token"));
  });

  it("hashes session tokens with sha256", () => {
    expect(sha256("abc")).toMatch(/^[a-f0-9]{64}$/);
    expect(sha256("abc")).toBe(sha256("abc"));
  });
});
