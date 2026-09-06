import { afterEach, describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/password";
import { cookieSecure, sessionCookieMaxAgeSeconds, sessionCookieOptions } from "@/server/auth/session-core";

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

  it("sets Max-Age so WebView can persist the session cookie", () => {
    const now = 1_800_000_000_000;
    const expiresAt = new Date(now + 7 * 24 * 60 * 60 * 1000);
    expect(sessionCookieMaxAgeSeconds(expiresAt, now)).toBe(7 * 24 * 60 * 60);
    const opts = sessionCookieOptions(new Date(Date.now() + 3_600_000));
    expect(opts.maxAge).toBeGreaterThan(0);
    expect(opts.expires).toBeInstanceOf(Date);
    expect(opts.path).toBe("/");
  });
});
