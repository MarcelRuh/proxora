import { afterEach, describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import { assertSameOrigin, isAllowedOrigin } from "@/server/http/respond";

const originalAppUrl = process.env.APP_URL;
const originalAllowed = process.env.APP_ALLOWED_ORIGINS;

afterEach(() => {
  process.env.APP_URL = originalAppUrl;
  process.env.APP_ALLOWED_ORIGINS = originalAllowed;
});

function req(opts: { origin?: string; host?: string; forwardedHost?: string; method?: string }) {
  const headers = new Headers();
  if (opts.origin) headers.set("origin", opts.origin);
  if (opts.host) headers.set("host", opts.host);
  if (opts.forwardedHost) headers.set("x-forwarded-host", opts.forwardedHost);
  return new Request("http://127.0.0.1:3000/api/auth/login", {
    method: opts.method ?? "POST",
    headers,
  });
}

describe("CSRF origin check", () => {
  it("allows LAN IP when APP_URL is localhost", () => {
    process.env.APP_URL = "http://localhost:3000";
    const r = req({
      origin: "http://192.168.178.246:3000",
      host: "192.168.178.246:3000",
    });
    expect(isAllowedOrigin(r, "http://192.168.178.246:3000")).toBe(true);
    expect(() => assertSameOrigin(r)).not.toThrow();
  });

  it("allows Origin matching APP_URL even if Host is internal", () => {
    process.env.APP_URL = "https://proxora.example.com";
    const r = req({
      origin: "https://proxora.example.com",
      host: "proxora:3000",
    });
    expect(isAllowedOrigin(r, "https://proxora.example.com")).toBe(true);
  });

  it("allows extra origins from APP_ALLOWED_ORIGINS", () => {
    process.env.APP_URL = "http://localhost:3000";
    process.env.APP_ALLOWED_ORIGINS = "http://proxora.lan:3000";
    const r = req({
      origin: "http://proxora.lan:3000",
      host: "proxora:3000",
    });
    expect(isAllowedOrigin(r, "http://proxora.lan:3000")).toBe(true);
  });

  it("rejects a mismatched Origin", () => {
    process.env.APP_URL = "http://localhost:3000";
    const r = req({
      origin: "https://evil.example",
      host: "192.168.178.246:3000",
    });
    expect(isAllowedOrigin(r, "https://evil.example")).toBe(false);
    expect(() => assertSameOrigin(r)).toThrow(AppError);
  });

  it("skips GET requests", () => {
    process.env.APP_URL = "http://localhost:3000";
    expect(() =>
      assertSameOrigin(
        req({ origin: "https://evil.example", host: "localhost:3000", method: "GET" }),
      ),
    ).not.toThrow();
  });
});
