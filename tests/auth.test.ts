import { afterEach, describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/password";
import { cookieSecure } from "@/server/auth/session-core";

const originalAppUrl = process.env.APP_URL;
const originalCookieSecure = process.env.COOKIE_SECURE;

afterEach(() => {
  process.env.APP_URL = originalAppUrl;
  process.env.COOKIE_SECURE = originalCookieSecure;
});

describe("authentication helpers", () => {
  it("hashes and verifies passwords", async () => {
    const hash = await hashPassword("correct-horse-battery");
    expect(hash).not.toBe("correct-horse-battery");
    expect(hash.startsWith("$2")).toBe(true);
    expect(await verifyPassword("correct-horse-battery", hash)).toBe(true);
    expect(await verifyPassword("wrong-password", hash)).toBe(false);
  });

  it("does not mark cookies Secure on HTTP LAN URLs", () => {
    expect(cookieSecure("http://192.168.178.246:3000", undefined)).toBe(false);
    expect(cookieSecure("http://localhost:3000", undefined)).toBe(false);
    expect(cookieSecure("https://proxora.example.com", undefined)).toBe(true);
    expect(cookieSecure("http://192.168.178.246:3000", "true")).toBe(true);
    expect(cookieSecure("https://proxora.example.com", "false")).toBe(false);
  });
});
