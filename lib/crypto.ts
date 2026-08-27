import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from "node:crypto";
import { AppError } from "@/lib/errors";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;

function getKey(): Buffer {
  // Dynamic lookup so Next.js cannot inline the Docker build-time placeholder.
  const secret = process.env["ENCRYPTION_KEY"];
  if (!secret || secret.length < 32) {
    throw new AppError(
      500,
      "ENCRYPTION_KEY must be set to at least 32 characters",
      "CONFIG_ERROR",
    );
  }
  if (/^[0-9a-fA-F]{64}$/.test(secret)) {
    return Buffer.from(secret, "hex");
  }
  return scryptSync(secret, "proxora-secrets", KEY_LENGTH);
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv, { authTagLength: AUTH_TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${encrypted.toString("base64")}`;
}

export function decryptSecret(payload: string): string {
  const parts = payload.split(".");
  if (parts.length !== 3) {
    throw new AppError(500, "Invalid encrypted payload", "CRYPTO_ERROR");
  }
  const [ivB64, tagB64, dataB64] = parts;
  try {
    const decipher = createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivB64, "base64"), {
      authTagLength: AUTH_TAG_LENGTH,
    });
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(dataB64, "base64")),
      decipher.final(),
    ]);
    return decrypted.toString("utf8");
  } catch {
    throw new AppError(
      500,
      "Host credentials could not be decrypted. ENCRYPTION_KEY may have changed — re-enter the password on the host.",
      "CRYPTO_ERROR",
    );
  }
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}
